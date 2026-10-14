<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * When an account's first activation was handled by the welcome message
 * (App\Support\Messaging\WelcomeMessage), whether or not one was sent.
 *
 * Set once, the moment someone can first use the portal, so turning the
 * welcome message on later never greets people who joined before it, and a
 * suspended account that is reactivated is not welcomed a second time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('welcomed_at')->nullable();
        });

        // Everyone who has ever been let in has joined already. Accounts
        // still waiting on approval stay unmarked, so they are welcomed when
        // they are approved.
        DB::table('users')
            ->whereNull('welcomed_at')
            ->where(fn ($q) => $q->where('status', 'approved')->orWhereNotNull('approved_at'))
            ->update(['welcomed_at' => DB::raw('COALESCE(approved_at, created_at, CURRENT_TIMESTAMP)')]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('welcomed_at');
        });
    }
};
