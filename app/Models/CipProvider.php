<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * A CIP Service Provider firm — or the reserved PRI bucket that stands in for
 * private clients, so every application has a provider and a number prefix.
 *
 * The code prefixes internal application numbers (GAL26-00001) and drives a
 * per-provider sequence, so it must never change once numbers exist under it.
 */
#[Fillable([
    'uuid', 'name', 'code', 'company_id', 'folder_id', 'legacy_folder_id', 'contact_name', 'contact_email',
    'notification_emails', 'active',
])]
class CipProvider extends Model
{
    use SoftDeletes;

    /** The reserved code every private-client application files under. */
    public const PRIVATE_CLIENT_CODE = 'PRI';

    protected static function booted(): void
    {
        static::creating(function (self $provider) {
            $provider->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'notification_emails' => 'array',
            'active' => 'boolean',
        ];
    }

    /** Codes are stored uppercase whatever the form sent. */
    protected function code(): Attribute
    {
        return Attribute::make(
            set: fn (?string $value) => $value === null ? null : strtoupper(trim($value)),
        );
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    /**
     * Where the firm's applications are filed: its folder in the TMA CIP
     * Applications Portal once that library is set up, otherwise its drawer
     * in the Citizenship Applications library.
     */
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    /**
     * The firm's drawer in the old Citizenship Applications library, kept
     * after `folder_id` moved to the new site. Historical folders the sync
     * imported still live here, and still sync with that library.
     */
    public function legacyFolder(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'legacy_folder_id');
    }

    /**
     * The drawer a client folder belongs in: a folder the old library sync
     * imported stays under the old drawer, everything the portal made goes
     * to the current one. Moving an imported folder into the new site would
     * take it out from under the library it still syncs with.
     */
    public function drawerFor(?Folder $clientFolder): ?Folder
    {
        if ($clientFolder?->origin === 'sharepoint' && $this->legacy_folder_id) {
            return $this->legacyFolder ?? $this->folder;
        }

        return $this->folder;
    }

    public function applications(): HasMany
    {
        return $this->hasMany(CipApplication::class, 'provider_id');
    }
}
