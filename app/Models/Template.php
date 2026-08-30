<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A template an administrator has changed on the Templates page.
 *
 * `kind` says which family it belongs to (see App\Support\Templates\SystemEmails
 * for the first), `key` which template inside it, and `fields` the copy the
 * administrator saved, field by field. A system email with no row sends its
 * shipped default.
 */
#[Fillable(['uuid', 'kind', 'key', 'name', 'fields', 'updated_by'])]
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
}
