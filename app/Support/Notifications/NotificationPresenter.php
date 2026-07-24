<?php

namespace App\Support\Notifications;

use App\Models\ActivityLog;
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
            'meta' => $n->metadata,
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
            'avatar' => $user->avatar_url ?: $user->provider_avatar_url,
        ];
    }

    /**
     * Leading photo for the row/toast. Prefer the stored override; for email
     * notifications also resolve a cached sender photo from metadata so a
     * face shows even when the photo arrived after the notification was saved.
     */
    private static function image(Notification $n): ?string
    {
        if (is_string($n->image) && $n->image !== '') {
            return $n->image;
        }

        $email = $n->metadata['from_email'] ?? null;
        if (! is_string($email) || $email === '') {
            return null;
        }

        return \App\Models\MailSenderPhoto::urlFor($email);
    }
}
