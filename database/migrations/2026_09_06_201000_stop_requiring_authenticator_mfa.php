<?php

use App\Support\SecurityPolicies;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Authenticator apps are recommended, not required. Email codes already
 * confirm unusual sign-ins. A previous row (or env default) turned the
 * authenticator gate on for the whole firm and 403'd every JSON call.
 *
 * Forward-only: also drop remember cookies and database sessions so people
 * sign in again instead of sitting on an empty dashboard.
 */
return new class extends Migration
{
    public function up(): void
    {
        SecurityPolicies::disableRequiredAuthenticator();

        if (app()->runningUnitTests()) {
            return;
        }

        SecurityPolicies::setForceReauthAfter(now());

        if (Schema::hasColumn('users', 'remember_token')) {
            DB::table('users')->update(['remember_token' => null]);
        }

        if (Schema::hasTable('sessions')) {
            DB::table('sessions')->delete();
        }
    }

    public function down(): void
    {
        // Forward-only: requiring an authenticator is an administrator action.
    }
};
