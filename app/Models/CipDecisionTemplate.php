<?php

namespace App\Models;

use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One Granted or Denied letter for one investment type (§23).
 *
 * Ten rows, one per (investment type × outcome). The firm rewrites the copy
 * in Account settings; the filing subject stays §22's and is not stored here.
 */
#[Fillable([
    'uuid', 'investment_type', 'decision', 'title', 'body', 'updated_by',
])]
class CipDecisionTemplate extends Model
{
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

    public function investmentTypeLabel(): string
    {
        return InvestmentType::label((string) $this->investment_type);
    }

    public function decisionLabel(): string
    {
        return $this->decision === Status::GRANTED ? 'Granted' : 'Denied';
    }
}
