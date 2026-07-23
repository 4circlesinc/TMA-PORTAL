<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person's membership of a group. `role` governs running the group
 * (managers may add and remove members); it says nothing about what the group
 * can see — that is decided per calendar by the grant made to the group.
 */
#[Fillable(['group_id', 'user_id', 'role', 'added_by'])]
class GroupMember extends Model
{
    public const ROLE_MEMBER = 'member';

    public const ROLE_MANAGER = 'manager';

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
