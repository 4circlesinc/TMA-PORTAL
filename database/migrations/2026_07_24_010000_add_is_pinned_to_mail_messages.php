<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pinning is a portal-only concept — neither Gmail nor Graph exposes
 * Outlook-style pins over their APIs — so the flag lives purely on the
 * mirror and is never synced back to the provider.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            $table->boolean('is_pinned')->default(false)->after('is_important');
        });
    }

    public function down(): void
    {
        Schema::table('mail_messages', function (Blueprint $table) {
            $table->dropColumn('is_pinned');
        });
    }
};
