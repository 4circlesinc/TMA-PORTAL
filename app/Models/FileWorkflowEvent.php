<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'workflow_id', 'step_id', 'actor_id', 'company_member_id', 'actor_name',
    'action', 'detail', 'meta', 'created_at',
])]
class FileWorkflowEvent extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['meta' => 'array', 'created_at' => 'datetime'];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id')->withTrashed();
    }

    public function companyMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'company_member_id');
    }

    public function step(): BelongsTo
    {
        return $this->belongsTo(FileWorkflowStep::class, 'step_id');
    }
}
