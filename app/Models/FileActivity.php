<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id', 'company_member_id', 'actor_name', 'item_type', 'item_id',
    'action', 'meta', 'ip', 'created_at',
])]
class FileActivity extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    public function companyMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'company_member_id');
    }
}
