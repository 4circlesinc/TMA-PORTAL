<?php

namespace App\Models;

use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * One Granted or Denied letter for one investment type, in one lane
 * (section 23).
 *
 * Twenty rows, one per (investment type × phase × outcome). The two lanes
 * keep their own pair because Approved means a different thing to the reader
 * either side of the decision — see {@see \App\Support\Cip\Letters::defaults()}.
 * The firm rewrites the copy in Account settings; the filing subject stays
 * section 22's and is not stored here.
 */
#[Fillable([
    'uuid', 'investment_type', 'phase', 'decision', 'title', 'body', 'updated_by',
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

    public function phaseLabel(): string
    {
        return Phase::label((string) ($this->phase ?: Phase::PRE_APPROVAL));
    }
}
