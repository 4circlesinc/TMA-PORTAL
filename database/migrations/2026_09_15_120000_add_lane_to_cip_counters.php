<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add-On reference numbers ([Code]-AO-[YY]-[Sequence]) keep their own
 * sequence, so filing GAL-AO-26-00001 does not consume GAL26-00002.
 *
 * cip_counters was one row per (provider, year). The lane column splits
 * that: family applications stay on `application`, Add-On files use
 * `add_on`. Existing rows default to `application`, which is the sequence
 * they already advanced.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_counters', function (Blueprint $table) {
            $table->string('lane', 16)->default('application');
        });

        Schema::table('cip_counters', function (Blueprint $table) {
            $table->dropUnique(['provider_id', 'year']);
        });

        Schema::table('cip_counters', function (Blueprint $table) {
            $table->unique(['provider_id', 'year', 'lane']);
        });
    }

    public function down(): void
    {
        Schema::table('cip_counters', function (Blueprint $table) {
            $table->dropUnique(['provider_id', 'year', 'lane']);
        });

        Schema::table('cip_counters', function (Blueprint $table) {
            $table->dropColumn('lane');
        });

        Schema::table('cip_counters', function (Blueprint $table) {
            $table->unique(['provider_id', 'year']);
        });
    }
};
