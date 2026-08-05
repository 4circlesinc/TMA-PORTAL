<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'application_id', 'sheet_id', 'row_remote_id', 'parent_row_remote_id', 'position',
    'applicant_label', 'description', 'notes', 'agent_assessment', 'assessment_response',
    'is_done', 'row_modified_at',
])]
class CbiAssessmentItem extends Model
{
    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'is_done' => 'boolean',
            'row_modified_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CbiApplication::class, 'application_id');
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(SmartsheetSheet::class, 'sheet_id');
    }
}
