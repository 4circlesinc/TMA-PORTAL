<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A native app's push token (docs/android-app-prompt.md §13). */
#[Fillable(['user_id', 'platform', 'token', 'app_version', 'device_name', 'session_id', 'last_seen_at'])]
class DeviceToken extends Model
{
    public const PLATFORM_ANDROID = 'android';

    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
