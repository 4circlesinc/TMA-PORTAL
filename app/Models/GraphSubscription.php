<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GraphSubscription extends Model
{
    protected $table = 'graph_subscriptions';

    protected $guarded = [];

    public const KIND_MAIL = 'mail';

    public const KIND_DRIVE = 'drive';

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'last_notified_at' => 'datetime',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }

    public function connection(): BelongsTo
    {
        return $this->belongsTo(SharePointConnection::class, 'sharepoint_connection_id');
    }

    public function isExpiringSoon(): bool
    {
        return $this->expires_at->lte(now()->addHours(12));
    }
}
