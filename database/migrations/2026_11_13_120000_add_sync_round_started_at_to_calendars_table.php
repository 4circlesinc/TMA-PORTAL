<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * When the provider sync round behind `sync_cursor` began.
     *
     * Graph's calendarView delta link keeps the date range of the request
     * that started it, so a link followed for ever would never see past the
     * end it was minted with. The synchronizer starts a fresh round once
     * this is a month old. Null: unknown, treated as due.
     */
    public function up(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->timestamp('sync_round_started_at')->nullable()->after('sync_cursor');
        });
    }

    public function down(): void
    {
        Schema::table('calendars', function (Blueprint $table) {
            $table->dropColumn('sync_round_started_at');
        });
    }
};
