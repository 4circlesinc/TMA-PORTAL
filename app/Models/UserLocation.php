<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[\Illuminate\Database\Eloquent\Attributes\Fillable([
    'user_id', 'type', 'label', 'address', 'latitude', 'longitude', 'radius_m', 'enabled',
])]
class UserLocation extends Model
{
    public const TYPE_OFFICE = 'office';

    public const TYPE_REMOTE = 'remote';

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'radius_m' => 'integer',
            'enabled' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Haversine distance in metres between this location and a point. */
    public function distanceTo(float $lat, float $lng): float
    {
        $earth = 6371000;
        $latFrom = deg2rad((float) $this->latitude);
        $lngFrom = deg2rad((float) $this->longitude);
        $latTo = deg2rad($lat);
        $lngTo = deg2rad($lng);
        $dLat = $latTo - $latFrom;
        $dLng = $lngTo - $lngFrom;
        $a = sin($dLat / 2) ** 2 + cos($latFrom) * cos($latTo) * sin($dLng / 2) ** 2;

        return 2 * $earth * asin(min(1, sqrt($a)));
    }

    public function contains(float $lat, float $lng): bool
    {
        return $this->distanceTo($lat, $lng) <= (float) ($this->radius_m ?: 100);
    }
}
