<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'type', 'status', 'detail'])]
class PrivacyRequest extends Model
{
    public const TYPE_EXPORT = 'export';

    public const TYPE_ERASURE = 'erasure';

    public const TYPE_RESTRICTION = 'restriction';

    public const TYPE_RESTRICTION_LIFTED = 'restriction_lifted';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_REFUSED = 'refused';

    protected function casts(): array
    {
        return [
            'detail' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
