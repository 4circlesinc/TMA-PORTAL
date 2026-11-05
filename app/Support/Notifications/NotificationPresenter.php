<?php

namespace App\Support\Notifications;

use App\Models\ActivityLog;
use App\Models\MailSenderPhoto;
use App\Models\Notification;
use App\Models\User;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\DocumentStatus;
use App\Support\DeviceName;
use App\Support\Security\IpLocation;
use Illuminate\Support\Str;

/**
 * Turns notification and activity rows into the JSON shapes the portal front-end
 * renders. One place decides the contract so the right sidebar, the header
 * popups, and the Overview activity log all read the same fields.
 *
 * Actors are serialised as `{ id, name, avatar }`, the avatar is a real photo
 * URL or null. When it is null the front-end draws an initials tile (section 3, section 4);
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
            'icon' => $n->icon,          // Phosphor name, the system-icon fallback
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
     *                                   and the before/after value diff (section 9, section 28)
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
            'description' => self::describe($log),
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
            // Where the address sits, to the nearest city. Sensitive for the
            // same reason the IP is: it says where a colleague was, so only
            // viewers already trusted with the address see it.
            'location' => $includeSensitive ? IpLocation::describe([
                'city' => $log->city,
                'region' => $log->region,
                'country' => $log->country,
            ]) : null,
            'postal' => $includeSensitive ? $log->postal : null,
            'latitude' => $includeSensitive ? $log->latitude : null,
            'longitude' => $includeSensitive ? $log->longitude : null,
            'oldValues' => $includeSensitive ? $log->old_values : null,
            'newValues' => $includeSensitive ? $log->new_values : null,
            'details' => self::activityDetails(is_array($log->metadata) ? $log->metadata : []),
            'createdAt' => $log->created_at?->toIso8601String(),
        ];
    }

    /**
     * Older document rows called every write an override. The from and to
     * statuses were stored beside that sentence, and the review cycle says
     * which of those pairs was a real override.
     */
    private static function describe(ActivityLog $log): string
    {
        $description = DocumentTypes::presentFormCodes((string) $log->description);
        if ($log->activity_type !== 'cip.document_status_changed') {
            return $description;
        }

        // Rows written when an upload was logged as a status move. Entering
        // Application review is what an upload does by itself.
        $marker = ' moved to '.DocumentStatus::label(DocumentStatus::APPLICATION_REVIEW);
        if (str_ends_with($description, $marker)) {
            $head = substr($description, 0, -strlen($marker));

            return 'uploaded '.$head.'; status set to Application review automatically';
        }

        if (! str_contains($description, 'status overridden to ')) {
            return $description;
        }

        $from = is_array($log->old_values) ? ($log->old_values['status'] ?? null) : null;
        $to = is_array($log->new_values) ? ($log->new_values['status'] ?? null) : null;
        if (! is_string($from) || ! is_string($to) || ! DocumentEngine::isMapped($from, $to)) {
            return $description;
        }

        $toLabel = DocumentStatus::label($to);

        return str_replace(
            'status overridden to '.$toLabel,
            'moved from '.DocumentStatus::label($from).' to '.$toLabel,
            $description,
        );
    }

    /**
     * Facts every viewer can read. IP and the before/after diff stay behind
     * the administrator check; a document's version does not.
     *
     * @param  array<string, mixed>  $meta
     * @return list<array{label:string, value:string}>
     */
    private static function activityDetails(array $meta): array
    {
        $rows = [];
        $document = '';
        if (is_string($meta['label'] ?? null) && $meta['label'] !== '') {
            $document = $meta['label'];
        } elseif (is_string($meta['document'] ?? null) && $meta['document'] !== '' && ! Str::isUuid($meta['document'])) {
            $document = $meta['document'];
        }
        if ($document !== '') {
            $rows[] = ['label' => 'Document', 'value' => DocumentTypes::present($document)];
        }

        $text = [
            'application' => 'Application',
            'fileName' => 'File',
            'libraryName' => 'Checklist file',
            'uploadedAs' => 'Uploaded file',
            'note' => 'Note',
        ];
        foreach ($text as $key => $label) {
            if (! is_string($meta[$key] ?? null) || $meta[$key] === '') {
                continue;
            }
            if ($key === 'libraryName' && $meta[$key] === ($meta['fileName'] ?? null)) {
                continue;
            }
            $rows[] = ['label' => $label, 'value' => $meta[$key]];
        }

        if (isset($meta['version']) && $meta['version'] !== '' && $meta['version'] !== null) {
            $rows[] = ['label' => 'Version', 'value' => (string) $meta['version']];
        }
        foreach (['fromStatus' => 'From', 'toStatus' => 'To'] as $key => $label) {
            if (! is_string($meta[$key] ?? null) || ! DocumentStatus::isValid($meta[$key])) {
                continue;
            }
            $rows[] = ['label' => $label, 'value' => DocumentStatus::label($meta[$key])];
        }

        return $rows;
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
            if (preg_match('/^New email from\s+(.+)$/u', $title, $m)
                || preg_match('/^(.+?)\s+sent you an email$/u', $title, $m)
                || preg_match('/^(.+?)\s+replied to your email$/u', $title, $m)) {
                $meta['from_name'] = trim($m[1]);
            } elseif (preg_match('/^From\s+(.+?)\s+[—-]/u', (string) $n->message, $m)) {
                $meta['from_name'] = trim($m[1]);
            }
        }

        return $meta === [] ? null : $meta;
    }
}
