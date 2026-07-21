<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A viewer's personal colour/icon choice for a regular folder. Private to that user. */
#[Fillable(['user_id', 'folder_id', 'colour', 'icon_name'])]
class FolderColourPreference extends Model
{
    public function folder(): BelongsTo
    {
        return $this->belongsTo(Folder::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
