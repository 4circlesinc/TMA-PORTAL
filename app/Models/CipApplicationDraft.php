<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One reader's unfinished application, saved as they type it.
 *
 * Not an application. It holds no number, appears in no queue and nobody but
 * its author can read it; it exists so that closing a laptop halfway through
 * a twenty-field form is not the same as starting again. The moment the
 * filing lands it is deleted — a draft that outlived the application it
 * became would offer to resume work already filed.
 *
 * @see database/migrations/2026_09_09_120000_create_cip_application_drafts_table.php
 */
#[Fillable(['uuid', 'user_id', 'phase', 'answers', 'dependents'])]
class CipApplicationDraft extends Model
{
    protected static function booted(): void
    {
        static::creating(function (self $draft) {
            $draft->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'answers' => 'array',
            'dependents' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
