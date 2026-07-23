<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A calendar — the container events live on and the unit permissions are
 * granted on. See the create_calendars_table migration for how `calendar_type`
 * (what it is) differs from `source` (where its events come from).
 */
#[Fillable([
    'uuid', 'name', 'description', 'colour', 'calendar_type', 'owner_id',
    'client_id', 'timezone', 'visibility', 'default_role', 'source',
    'connected_account_id', 'external_id', 'subscription_url',
    'subscription_frequency', 'subscription_status', 'subscription_error',
    'subscription_synced_at', 'subscription_attempted_at',
    'subscription_etag', 'subscription_failures',
    'sync_direction', 'sync_cursor', 'sync_window_start', 'sync_cancelled',
    'is_system', 'is_archived', 'created_by',
])]
class Calendar extends Model
{
    use SoftDeletes;

    public const TYPE_PERSONAL = 'personal';

    public const TYPE_SHARED = 'shared';

    public const TYPE_GROUP = 'group';

    public const TYPE_DEPARTMENT = 'department';

    public const TYPE_PROJECT = 'project';

    public const TYPE_CLIENT = 'client';

    public const TYPE_ORGANIZATION = 'organization';

    public const TYPES = [
        self::TYPE_PERSONAL, self::TYPE_SHARED, self::TYPE_GROUP,
        self::TYPE_DEPARTMENT, self::TYPE_PROJECT, self::TYPE_CLIENT,
        self::TYPE_ORGANIZATION,
    ];

    public const SOURCE_LOCAL = 'local';

    public const SOURCE_GOOGLE = 'google';

    public const SOURCE_MICROSOFT = 'microsoft';

    public const SOURCE_ICS_IMPORT = 'ics_import';

    public const SOURCE_ICS_SUBSCRIPTION = 'ics_subscription';

    public const VISIBILITIES = ['private', 'shared', 'all_staff'];

    protected function casts(): array
    {
        return [
            'is_system' => 'boolean',
            'is_archived' => 'boolean',
            'deleted_at' => 'datetime',
            'subscription_synced_at' => 'datetime',
            'subscription_attempted_at' => 'datetime',
            'sync_window_start' => 'datetime',
            'sync_cancelled' => 'boolean',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'client_id');
    }

    public function connectedAccount(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(CalendarEvent::class);
    }

    public function members(): HasMany
    {
        return $this->hasMany(CalendarMember::class);
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(CalendarSubscription::class);
    }

    /** Provisioned personal calendars can be emptied but never removed. */
    public function isDeletable(): bool
    {
        return ! $this->is_system;
    }

    /** Backed by Google or Microsoft, as opposed to an ICS feed or local. */
    public function isProviderSynced(): bool
    {
        return in_array($this->source, [self::SOURCE_GOOGLE, self::SOURCE_MICROSOFT], true);
    }

    /** Kept in step with anything external at all. */
    public function isSynced(): bool
    {
        return $this->isProviderSynced() || $this->source === self::SOURCE_ICS_SUBSCRIPTION;
    }

    /** Whether local changes are pushed out to the provider. */
    public function pushesOut(): bool
    {
        return $this->isProviderSynced()
            && in_array($this->sync_direction, ['two_way', 'export'], true);
    }

    /** Whether provider changes are pulled in. */
    public function pullsIn(): bool
    {
        return $this->isSynced()
            && (! $this->isProviderSynced() || in_array($this->sync_direction, ['two_way', 'import'], true));
    }

    /**
     * Which sidebar section this calendar belongs in for `$viewer`.
     *
     * The grouping is by relationship, not by type: the same team calendar is
     * "mine" to its owner and "group" to everyone else.
     *
     * @return 'mine'|'people'|'group'|'shared'|'connected'|'imported'
     */
    public function sectionFor(User $viewer): string
    {
        if (in_array($this->source, [self::SOURCE_GOOGLE, self::SOURCE_MICROSOFT], true)) {
            return 'connected';
        }

        if (in_array($this->source, [self::SOURCE_ICS_IMPORT, self::SOURCE_ICS_SUBSCRIPTION], true)) {
            return 'imported';
        }

        if ($this->owner_id === $viewer->id) {
            return 'mine';
        }

        if (in_array($this->calendar_type, [
            self::TYPE_GROUP, self::TYPE_DEPARTMENT, self::TYPE_PROJECT, self::TYPE_ORGANIZATION,
        ], true)) {
            return 'group';
        }

        // Someone else's personal calendar reads as "that person's calendar";
        // anything else they shared is just a shared calendar.
        return $this->calendar_type === self::TYPE_PERSONAL ? 'people' : 'shared';
    }

    /**
     * The shape the calendar sidebar consumes. `$role` and `$subscription`
     * are passed in rather than looked up so a list render stays one query.
     *
     * @return array<string, mixed>
     */
    public function toRecord(User $viewer, string $role, ?CalendarSubscription $subscription = null): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->name,
            'description' => $this->description,
            // The override only ever applies to the viewer's own calendars,
            // so an official group colour stays identical for everyone.
            'colour' => $subscription?->colour_override ?: $this->colour,
            'officialColour' => $this->colour,
            'type' => $this->calendar_type,
            'source' => $this->source,
            'section' => $this->sectionFor($viewer),
            'visibility' => $this->visibility,
            'timezone' => $this->timezone,
            'role' => $role,
            'isOwner' => $this->owner_id === $viewer->id,
            'isSystem' => (bool) $this->is_system,
            'isArchived' => (bool) $this->is_archived,
            'canDelete' => $this->isDeletable() && $role === 'owner',
            'ownerName' => $this->owner?->name,
            'clientId' => $this->client?->uid,
            'subscribed' => $subscription !== null,
            'visible' => $subscription ? (bool) $subscription->is_visible : false,
            // Sync state, so the sidebar can report a failing feed or a broken
            // provider connection against that one row rather than as a
            // page-level error.
            'sync' => $this->isSynced() ? [
                'status' => $this->subscription_status ?: 'ok',
                'error' => $this->subscription_error,
                'syncedAt' => $this->subscription_synced_at?->toIso8601String(),
                'frequency' => $this->subscription_frequency,
                'url' => $this->source === self::SOURCE_ICS_SUBSCRIPTION ? $this->subscription_url : null,
                'provider' => $this->source,
                'direction' => $this->sync_direction,
                // A provider calendar can be pushed to; an ICS feed cannot.
                'canWrite' => $this->isProviderSynced(),
                'accountEmail' => $this->connectedAccount?->email,
            ] : null,
        ];
    }
}
