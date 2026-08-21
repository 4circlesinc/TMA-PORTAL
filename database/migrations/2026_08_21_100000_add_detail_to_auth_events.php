<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Why an auth event happened, not just that it did.
 *
 * Added for refused social sign-ins, which until now recorded nothing at all:
 * the reason lived in a log line on the hosting platform, so "is this tenant
 * consent, app assignment, or a lost session?" was a question nobody inside
 * the portal could answer. Nullable, because every other event is already
 * self-explaining from its name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('auth_events', function (Blueprint $table) {
            $table->string('detail', 255)->nullable()->after('event');
        });
    }

    public function down(): void
    {
        Schema::table('auth_events', function (Blueprint $table) {
            $table->dropColumn('detail');
        });
    }
};
