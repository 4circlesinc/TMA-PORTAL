<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['connection_id', 'action', 'level', 'graph_item_id', 'detail', 'meta', 'created_at'])]
class SharePointSyncLog extends Model
{
    // Laravel would infer "share_point_…" from the class name.
    protected $table = 'sharepoint_sync_logs';

    public $timestamps = false;

    protected function casts(): array
    {
        return ['meta' => 'array', 'created_at' => 'datetime'];
    }
}
