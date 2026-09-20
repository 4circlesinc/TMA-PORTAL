<?php

use App\Listeners\RecordAuthEvent;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The firm-wide audit trail gains the location its `ip_address` implies.
 *
 * `activity_logs` recorded the address and the user agent but never where
 * either of them was, so the Activity tab could say who and when but not
 * where — the question an administrator actually asks of an audit trail.
 *
 * Only sign-ins resolve a location today ({@see RecordAuthEvent});
 * every other row leaves these null rather than spending a lookup on each
 * file download. The columns are here so that can change without a second
 * migration.
 *
 * All nullable, all additive. Nothing existing is altered or removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->string('country', 2)->nullable();
            $table->string('city', 120)->nullable();
            $table->string('region', 120)->nullable();
            $table->string('postal', 20)->nullable();
            $table->decimal('latitude', 9, 4)->nullable();
            $table->decimal('longitude', 9, 4)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->dropColumn(['country', 'city', 'region', 'postal', 'latitude', 'longitude']);
        });
    }
};
