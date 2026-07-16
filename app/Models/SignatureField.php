<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One placed field on the document. Coordinates are page-relative fractions
 * (0..1), never pixels - the editor and the PDF stamper render at different
 * scales and must agree on position.
 */
#[Fillable([
    'uuid', 'signature_request_id', 'signature_recipient_id', 'type', 'page',
    'x', 'y', 'width', 'height', 'required', 'value', 'completed_at',
])]
class SignatureField extends Model
{
    protected function casts(): array
    {
        return [
            'page' => 'integer',
            'x' => 'float',
            'y' => 'float',
            'width' => 'float',
            'height' => 'float',
            'required' => 'boolean',
            'completed_at' => 'datetime',
        ];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(SignatureRequest::class, 'signature_request_id');
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(SignatureRecipient::class, 'signature_recipient_id');
    }

    public function isComplete(): bool
    {
        return $this->completed_at !== null;
    }
}
