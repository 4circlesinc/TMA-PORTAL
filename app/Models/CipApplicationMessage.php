<?php

namespace App\Models;

use App\Support\Cip\Threads;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One line on an application's messaging centre (§24).
 *
 * Internal notes stay with staff. Provider messages are the side-channel
 * the email thread used to be. History is the application record: there is
 * no delete, and the body is plain text.
 */
#[Fillable([
    'uuid', 'application_id', 'author_id', 'company_member_id',
    'author_name', 'lane', 'body',
])]
class CipApplicationMessage extends Model
{
    public const LANE_INTERNAL = 'internal';

    public const LANE_PROVIDER = 'provider';

    public const LANES = [self::LANE_INTERNAL, self::LANE_PROVIDER];

    protected static function booted(): void
    {
        static::creating(function (self $message) {
            $message->uuid ??= (string) Str::uuid();
        });
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id')->withTrashed();
    }

    public function companyMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'company_member_id');
    }

    public function isInternal(): bool
    {
        return $this->lane === self::LANE_INTERNAL;
    }

    public function laneLabel(): string
    {
        return $this->lane === self::LANE_INTERNAL ? 'Internal' : Threads::PROVIDER_LABEL;
    }
}
