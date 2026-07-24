<?php

namespace App\Support\Notifications;

use App\Events\PortalNotificationCreated;
use App\Models\Client;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;

/**
 * The single entry point for raising a portal notification (§13, §23).
 *
 * Callers describe *what happened*; the Notifier fills in everything derivable
 * from the type registry (module, level, icon, priority, action label),
 * enforces the recipient's preferences (§21) and privacy rules, and collapses
 * repeats via a dedupe key. It never throws into the caller's flow — a failed
 * notification must not fail the action that triggered it (§27).
 *
 * Real-time fan-out (§24) is layered on in Phase 10; this class stays the one
 * place a notification is born, so that hook has a single home.
 */
final class Notifier
{
    /** How long a dedupe key collapses repeats, when the caller gives no window. */
    private const DEFAULT_DEDUPE_MINUTES = 60;

    /**
     * Raise one notification for one recipient. Returns the row, or null when it
     * was intentionally suppressed (preference off, self-notification, or a
     * dedupe hit that refreshed an existing row).
     *
     * @param  array<string, mixed>  $attrs {
     *     user:         User|int          recipient (required)
     *     type:         string            registry key (required)
     *     title:        string            (required)
     *     actor:        User|int|null     person who caused it; null = system
     *     message:      string|null
     *     subject:      Model|null        the related record
     *     client:       Client|int|null
     *     action_url:   string|null
     *     action_label: string|null       defaults from registry
     *     level:        string|null       defaults from registry
     *     icon:         string|null       defaults from registry
     *     image:        string|null       explicit avatar/logo override
     *     priority:     string|null       defaults from registry
     *     dedupe_key:   string|null
     *     dedupe_minutes: int|null
     *     metadata:     array|null
     * }
     */
    public static function send(array $attrs): ?Notification
    {
        try {
            return self::dispatch($attrs);
        } catch (\Throwable $e) {
            Log::error('Notifier.send failed', [
                'type' => $attrs['type'] ?? null,
                'user' => self::idOf($attrs['user'] ?? null),
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Send the same notification to many recipients (e.g. every administrator).
     * Duplicates and the acting user are skipped. Returns the rows created.
     *
     * @param  iterable<User|int>  $users
     * @param  array<string, mixed>  $attrs
     * @return array<int, Notification>
     */
    public static function sendToMany(iterable $users, array $attrs): array
    {
        $created = [];
        $seen = [];
        foreach ($users as $user) {
            $id = self::idOf($user);
            if ($id === null || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $one = self::send(array_merge($attrs, ['user' => $user]));
            if ($one) {
                $created[] = $one;
            }
        }

        return $created;
    }

    /**
     * Fan a notification out to every approved administrator — the recipient
     * set for approval requests, security alerts, and failed system jobs (§16).
     *
     * @param  array<string, mixed>  $attrs
     * @return array<int, Notification>
     */
    public static function notifyAdmins(array $attrs): array
    {
        $admins = User::query()
            ->where('account_type', 'Administrator')
            ->where('status', User::STATUS_APPROVED)
            ->get();

        return self::sendToMany($admins, $attrs);
    }

    private static function dispatch(array $attrs): ?Notification
    {
        $recipient = self::resolveUser($attrs['user'] ?? null);
        $type = $attrs['type'] ?? null;
        $title = $attrs['title'] ?? null;

        if (! $recipient || ! is_string($type) || $type === '' || ! is_string($title) || $title === '') {
            Log::warning('Notifier.send skipped: missing recipient, type, or title', ['type' => $type]);

            return null;
        }

        $actorId = self::idOf($attrs['actor'] ?? null);

        // Never tell someone about their own action (§13). System notifications
        // (null actor) about the recipient — "your export is ready" — still pass.
        if ($actorId !== null && $actorId === $recipient->id) {
            return null;
        }

        // Respect the recipient's preferences, except for alerts that can't be
        // silenced (§21).
        if (! NotificationPreferences::portalEnabled($recipient, $type)) {
            return null;
        }

        $def = NotificationType::definition($type);
        $dedupeKey = $attrs['dedupe_key'] ?? null;

        // Collapse repeats: a matching, still-unread row inside the window is
        // refreshed instead of a second row being created (§23).
        if (is_string($dedupeKey) && $dedupeKey !== '') {
            $existing = self::findDuplicate($recipient, $dedupeKey, (int) ($attrs['dedupe_minutes'] ?? self::DEFAULT_DEDUPE_MINUTES));
            if ($existing) {
                return self::refresh($existing, $attrs, $def, $actorId);
            }
        }

        $subject = $attrs['subject'] ?? null;

        $notification = Notification::create([
            'user_id' => $recipient->id,
            'actor_id' => $actorId,
            'type' => $type,
            'level' => $attrs['level'] ?? $def['level'],
            'module' => $attrs['module'] ?? $def['module'],
            'title' => $title,
            'message' => $attrs['message'] ?? null,
            'icon' => $attrs['icon'] ?? $def['icon'],
            'image' => $attrs['image'] ?? null,
            'subject_type' => $subject instanceof Model ? $subject->getMorphClass() : null,
            'subject_id' => $subject instanceof Model ? $subject->getKey() : null,
            'client_id' => self::idOf($attrs['client'] ?? null),
            'action_url' => $attrs['action_url'] ?? null,
            'action_label' => array_key_exists('action_label', $attrs) ? $attrs['action_label'] : $def['action_label'],
            'priority' => $attrs['priority'] ?? $def['priority'],
            'dedupe_key' => is_string($dedupeKey) && $dedupeKey !== '' ? $dedupeKey : null,
            'metadata' => is_array($attrs['metadata'] ?? null) ? $attrs['metadata'] : null,
        ]);

        self::broadcast($notification);

        return $notification;
    }

    /**
     * Push the notification to the recipient's open sessions (§24). Best-effort:
     * a broadcast failure (Reverb down, no driver) must never fail the caller.
     */
    private static function broadcast(Notification $notification): void
    {
        try {
            $notification->loadMissing('actor');
            $unread = Notification::query()
                ->where('user_id', $notification->user_id)
                ->whereNull('read_at')
                ->count();

            event(new PortalNotificationCreated(
                (int) $notification->user_id,
                NotificationPresenter::notification($notification),
                $unread,
            ));
        } catch (\Throwable $e) {
            Log::warning('Notifier.broadcast failed', ['error' => $e->getMessage()]);
        }
    }

    private static function findDuplicate(User $recipient, string $dedupeKey, int $minutes): ?Notification
    {
        $query = Notification::query()
            ->where('user_id', $recipient->id)
            ->where('dedupe_key', $dedupeKey)
            ->whereNull('read_at');

        if ($minutes > 0) {
            $query->where('created_at', '>=', Carbon::now()->subMinutes($minutes));
        }

        return $query->latest('id')->first();
    }

    /**
     * Refresh a deduped row: bump it to the top, keep it unread, and track how
     * many events it now represents in metadata (so the UI can say "3 files").
     */
    private static function refresh(Notification $existing, array $attrs, array $def, ?int $actorId): Notification
    {
        $metadata = $existing->metadata ?? [];
        $metadata['count'] = ($metadata['count'] ?? 1) + 1;
        if (is_array($attrs['metadata'] ?? null)) {
            $metadata = array_merge($metadata, $attrs['metadata']);
        }

        $existing->forceFill([
            'title' => $attrs['title'] ?? $existing->title,
            'message' => $attrs['message'] ?? $existing->message,
            'actor_id' => $actorId ?? $existing->actor_id,
            'image' => array_key_exists('image', $attrs) ? $attrs['image'] : $existing->image,
            'metadata' => $metadata,
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ])->save();

        self::broadcast($existing);

        return $existing;
    }

    private static function resolveUser(mixed $value): ?User
    {
        if ($value instanceof User) {
            return $value;
        }
        if (is_numeric($value)) {
            return User::find((int) $value);
        }

        return null;
    }

    private static function idOf(mixed $value): ?int
    {
        if ($value instanceof User || $value instanceof Client) {
            return (int) $value->getKey();
        }
        if (is_numeric($value)) {
            return (int) $value;
        }

        return null;
    }
}
