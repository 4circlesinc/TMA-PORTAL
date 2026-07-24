<?php

namespace App\Support\Notifications;

use App\Models\ActivityLog;
use App\Models\MailSenderPhoto;
use App\Models\Notification;
use App\Models\User;
use App\Support\DeviceName;

/**
 * Turns notification and activity rows into the JSON shapes the portal front-end
 * renders. One place decides the contract so the right sidebar, the header
 * popups, and the Overview activity log all read the same fields.
 *
 * Actors are serialised as `{ id, name, avatar }` — the avatar is a real photo
 * URL or null. When it is null the front-end draws an initials tile (§3, §4);
 * we never hand it a stock or broken image path.
 */
final class NotificationPresenter
{
    /** @return array<string, mixed> */
    public static function notification(Notification $n): array
    {
        return [
            'id' => $n->uid,
            'type' => $n->type,
            'level' => $n->level,
            'module' => $n->module,
            'priority' => $n->priority,
            'title' => $n->title,
            'message' => $n->message,
            'icon' => $n->icon,          // Phosphor name — the system-icon fallback
            'image' => self::image($n),  // sender/client photo when available
            'isSystem' => $n->isSystem(),
            'actor' => self::actor($n->actor),
            'actionUrl' => $n->action_url,
            'actionLabel' => $n->action_label,
            'subjectType' => $n->subject_type ? class_basename($n->subject_type) : null,
            'subjectId' => $n->subject_id,
            'read' => $n->isRead(),
            'readAt' => $n->read_at?->toIso8601String(),
            'requiresAction' => $n->requiresAction(),
            'completed' => $n->completed_at !== null,
            'createdAt' => $n->created_at?->toIso8601String(),
            'meta' => self::meta($n),
        ];
    }

    /**
     * @param  bool  $includeSensitive  whether the viewer may see IP, device,
     *                                   and the before/after value diff (§9, §28)
     * @return array<string, mixed>
     */
    public static function activity(ActivityLog $log, bool $includeSensitive): array
    {
        return [
            'id' => $log->uid,
            'type' => $log->activity_type,
            'module' => $log->module,
            'action' => $log->action,
            'status' => $log->status,
            'description' => $log->description,
            'isSystem' => $log->isSystem(),
            'actor' => self::actor($log->actor),
            'client' => $log->client ? [
                'id' => $log->client->uid,
                'name' => $log->client->name,
                'initial' => $log->client->initial,
                'color' => $log->client->initial_color,
            ] : null,
            'subjectType' => $log->subject_type ? class_basename($log->subject_type) : null,
            'subjectId' => $log->subject_id,
            'ip' => $includeSensitive ? $log->ip_address : null,
            'device' => $includeSensitive && $log->user_agent ? DeviceName::describe($log->user_agent) : null,
            'oldValues' => $includeSensitive ? $log->old_values : null,
            'newValues' => $includeSensitive ? $log->new_values : null,
            'createdAt' => $log->created_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed>|null */
    public static function actor(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            // Real photo only; null tells the front-end to draw initials.
            'avatar' => $user->photoUrl(),
        ];
    }

    /**
     * Leading photo for the row/toast. Email notifications use the same
     * sender image the inbox list would show (portal user → directory /
     * Gravatar / brand logo via {@see MailSenderPhoto::urlFor}). Missing
     * images fall through to initials on the front-end, seeded by email so
     * colours match the mailbox.
     */
    private static function image(Notification $n): ?string
    {
        $isEmail = $n->module === 'email' || str_starts_with((string) $n->type, 'email.');
        $email = is_string($n->metadata['from_email'] ?? null)
            ? mb_strtolower(trim((string) $n->metadata['from_email']))
            : '';

        if ($isEmail) {
            if ($email !== '' && str_contains($email, '@')) {
                $portal = self::portalPhotoForEmail($email);
                if ($portal) {
                    return $portal;
                }

                // Same source as MailController::avatarFor / inbox rows.
                return MailSenderPhoto::urlFor($email);
            }

            return null;
        }

        if (is_string($n->image) && $n->image !== '' && self::isUsablePhotoUrl($n->image)) {
            return $n->image;
        }

        if ($email !== '' && str_contains($email, '@')) {
            $portal = self::portalPhotoForEmail($email);
            if ($portal) {
                return $portal;
            }

            return MailSenderPhoto::urlFor($email);
        }

        return null;
    }

    private static function portalPhotoForEmail(string $email): ?string
    {
        $user = User::query()
            ->whereRaw('lower(email) = ?', [$email])
            ->first(['avatar_url', 'provider_avatar_url']);

        $url = $user?->photoUrl();

        return self::isUsablePhotoUrl($url) ? $url : null;
    }

    private static function isUsablePhotoUrl(?string $url): bool
    {
        if (! is_string($url) || $url === '') {
            return false;
        }

        // Reject obvious icon files; allow absolute and portal-relative photos.
        if (preg_match('/\.(ico|gif)(\?|$)/i', $url)) {
            return false;
        }

        return (bool) preg_match('#^(https?:|/(storage|media|portal)/|data:)#i', $url);
    }

    /**
     * Ensure email notifications always expose a sender name for initials,
     * even when they were saved before metadata.from_name existed.
     *
     * @return array<string, mixed>|null
     */
    private static function meta(Notification $n): ?array
    {
        $meta = is_array($n->metadata) ? $n->metadata : [];
        $isEmail = $n->module === 'email' || str_starts_with((string) $n->type, 'email.');

        if ($isEmail && empty($meta['from_name'])) {
            $title = (string) $n->title;
            if (preg_match('/^New email from\s+(.+)$/u', $title, $m)) {
                $meta['from_name'] = trim($m[1]);
            } elseif (preg_match('/^From\s+(.+?)\s+[—-]/u', (string) $n->message, $m)) {
                $meta['from_name'] = trim($m[1]);
            }
        }

        return $meta === [] ? null : $meta;
    }
}
