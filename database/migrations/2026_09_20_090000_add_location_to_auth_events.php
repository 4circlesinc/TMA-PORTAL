<?php

use App\Support\Security\IpLocation;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a sign-in came from, beside the address it came from.
 *
 * `country` already existed (2026_09_06) and is left exactly as it is — it
 * comes from Cloudflare's edge header, costs nothing and is trusted over a
 * provider's opinion. These columns carry what the edge cannot say: city,
 * region, postal code and the coordinates of that city, resolved from a
 * lookup ({@see IpLocation}).
 *
 * All nullable, all additive. Existing rows keep their data and simply read
 * as unresolved, which is the truth about them: nothing recorded a location
 * at the time, and nothing invents one after the fact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('auth_events', function (Blueprint $table) {
            $table->string('city', 120)->nullable();
            $table->string('region', 120)->nullable();
            $table->string('postal', 20)->nullable();
            // 7,4 covers the full range to ~11m, far finer than a city centroid.
            $table->decimal('latitude', 9, 4)->nullable();
            $table->decimal('longitude', 9, 4)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('auth_events', function (Blueprint $table) {
            $table->dropColumn(['city', 'region', 'postal', 'latitude', 'longitude']);
        });
    }
};
