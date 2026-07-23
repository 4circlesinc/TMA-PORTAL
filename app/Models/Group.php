<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A named set of staff — a team, department, project or committee.
 *
 * Org-wide and reusable: a calendar granted to this group follows its
 * membership, so people gain and lose access by joining and leaving rather
 * than by being re-shared with individually.
 */
#[Fillable(['uuid', 'name', 'description', 'group_type', 'auto_join', 'is_archived', 'created_by'])]
class Group extends Model
{
    use SoftDeletes;

    public const TYPE_TEAM = 'team';

    public const TYPE_DEPARTMENT = 'department';

    public const TYPE_PROJECT = 'project';

    public const TYPE_COMMITTEE = 'committee';

    public const TYPE_ORGANIZATION = 'organization';

    public const TYPES = [
        self::TYPE_TEAM, self::TYPE_DEPARTMENT, self::TYPE_PROJECT,
        self::TYPE_COMMITTEE, self::TYPE_ORGANIZATION,
    ];

    protected function casts(): array
    {
        return [
            'auto_join' => 'boolean',
            'is_archived' => 'boolean',
            'deleted_at' => 'datetime',
        ];
    }

    public function members(): HasMany
    {
        return $this->hasMany(GroupMember::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return array<string, mixed>
     */
    public function toRecord(int $memberCount = 0, ?string $viewerRole = null): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->name,
            'description' => $this->description,
            'type' => $this->group_type,
            'autoJoin' => (bool) $this->auto_join,
            'isArchived' => (bool) $this->is_archived,
            'memberCount' => $memberCount,
            'createdAt' => $this->created_at?->toIso8601String(),
            // 'manager' | 'member' | null — what the viewer is in this group.
            'myRole' => $viewerRole,
        ];
    }
}
