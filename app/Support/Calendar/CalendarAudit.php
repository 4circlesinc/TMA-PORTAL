<?php

namespace App\Support\Calendar;

use App\Models\Calendar;
use App\Models\CalendarAuditEvent;
use App\Models\CalendarEvent;
use App\Models\User;

/**
 * Records what happened to a calendar or an event.
 *
 * Writing is deliberately best-effort: an audit row that cannot be written
 * must never take the action down with it. Losing one line of history is bad;
 * refusing to save someone's meeting because of it is worse.
 */
class CalendarAudit
{
    public const CALENDAR_CREATED = 'calendar.created';

    public const CALENDAR_UPDATED = 'calendar.updated';

    public const CALENDAR_DELETED = 'calendar.deleted';

    public const CALENDAR_ARCHIVED = 'calendar.archived';

    public const CALENDAR_SHARED = 'calendar.shared';

    public const CALENDAR_UNSHARED = 'calendar.unshared';

    public const PERMISSION_CHANGED = 'permission.changed';

    public const CALENDAR_CONNECTED = 'calendar.connected';

    public const CALENDAR_DISCONNECTED = 'calendar.disconnected';

    public const EVENT_CREATED = 'event.created';

    public const EVENT_UPDATED = 'event.updated';

    public const EVENT_MOVED = 'event.moved';

    public const EVENT_DELETED = 'event.deleted';

    public const INVITATION_SENT = 'invitation.sent';

    public const RESPONSE_RECEIVED = 'response.received';

    public const ICS_IMPORTED = 'ics.imported';

    public const ICS_EXPORTED = 'ics.exported';

    public const SYNC_FAILED = 'sync.failed';

    public const SYNC_COMPLETED = 'sync.completed';

    public const CONFLICT_DETECTED = 'conflict.detected';

    /**
     * @param  array<string, mixed>  $context
     */
    public static function record(
        string $action,
        ?User $actor = null,
        ?Calendar $calendar = null,
        ?CalendarEvent $event = null,
        array $context = [],
    ): void {
        try {
            CalendarAuditEvent::create([
                'action' => $action,
                'actor_id' => $actor?->id,
                // Copied in so the line still reads after the account is gone.
                'actor_name' => $actor?->name,
                'calendar_id' => $calendar?->id,
                'calendar_name' => $calendar?->name,
                'event_id' => $event?->exists ? $event->id : null,
                'event_title' => $event?->title,
                'context' => $context ?: null,
                'created_at' => now(),
            ]);
        } catch (\Throwable) {
            // Never let bookkeeping break the thing it is describing.
        }
    }

    /** Plain-language line for the history list. */
    public static function describe(CalendarAuditEvent $row): string
    {
        $who = $row->actor_name ?: 'System';
        $calendar = $row->calendar_name ?: 'a calendar';
        $event = $row->event_title ?: 'an event';
        $context = $row->context ?? [];

        return match ($row->action) {
            self::CALENDAR_CREATED => "{$who} created {$calendar}",
            self::CALENDAR_UPDATED => "{$who} changed {$calendar}",
            self::CALENDAR_DELETED => "{$who} deleted {$calendar}",
            self::CALENDAR_ARCHIVED => "{$who} archived {$calendar}",
            self::CALENDAR_SHARED => "{$who} shared {$calendar} with "
                .($context['with'] ?? 'someone')
                .(isset($context['role']) ? ' ('.$context['role'].')' : ''),
            self::CALENDAR_UNSHARED => "{$who} removed ".($context['with'] ?? 'someone')."’s access to {$calendar}",
            self::PERMISSION_CHANGED => "{$who} changed ".($context['with'] ?? 'someone')
                ."’s permission on {$calendar} to ".($context['role'] ?? 'a new level'),
            self::CALENDAR_CONNECTED => "{$who} connected {$calendar} to ".($context['provider'] ?? 'a provider'),
            self::CALENDAR_DISCONNECTED => "{$who} disconnected {$calendar}",
            self::EVENT_CREATED => "{$who} created {$event}",
            self::EVENT_UPDATED => "{$who} edited {$event}",
            self::EVENT_MOVED => "{$who} moved {$event}",
            self::EVENT_DELETED => "{$who} deleted {$event}",
            self::INVITATION_SENT => "{$who} invited ".($context['count'] ?? 'people')." to {$event}",
            self::RESPONSE_RECEIVED => "{$who} ".($context['response'] ?? 'replied to')." {$event}",
            self::ICS_IMPORTED => "{$who} imported ".($context['imported'] ?? 0)." event(s) into {$calendar}",
            self::ICS_EXPORTED => "{$who} exported {$calendar}",
            self::SYNC_COMPLETED => "Synced {$calendar}",
            self::SYNC_FAILED => "Sync failed for {$calendar}".(isset($context['error']) ? ': '.$context['error'] : ''),
            self::CONFLICT_DETECTED => "{$event} was changed in both places",
            default => "{$who} — {$row->action}",
        };
    }
}
