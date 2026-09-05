<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A template stored from the Templates page.
 *
 * `kind` says which family it belongs to (see App\Support\Templates\SystemEmails
 * for the first), `key` which template inside it, and `fields` the copy saved,
 * field by field. A system email with no row sends its shipped default.
 *
 * Compose-email rows also carry `user_id`: null is a firm default everyone
 * with a mailbox can start from; a filled id is that person's own template.
 */
#[Fillable(['uuid', 'kind', 'key', 'name', 'fields', 'updated_by', 'user_id'])]
class Template extends Model
{
    protected function casts(): array
    {
        return [
            'fields' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $template) {
            $template->uuid ??= (string) Str::uuid();
        });
    }

    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
