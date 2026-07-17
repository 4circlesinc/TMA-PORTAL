<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'uuid', 'name', 'parent_id', 'owner_id', 'created_by', 'deleted_by',
    'folder_type', 'client_id', 'subject_user_id', 'audience', 'audience_role',
    'org_wide', 'is_archived',
])]
class Folder extends Model
{
    use SoftDeletes;

    public const TYPE_USER = 'user';

    public const TYPE_ROOT = 'root';

    public const TYPE_ORGANIZATION = 'organization';

    public const TYPE_CLIENT = 'client';

    public const TYPE_STAFF = 'staff';

    protected function casts(): array
    {
        return [
            'deleted_at' => 'datetime',
            'org_wide' => 'boolean',
            'is_archived' => 'boolean',
        ];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class, 'client_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Folder::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Folder::class, 'parent_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(FileItem::class, 'folder_id');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
