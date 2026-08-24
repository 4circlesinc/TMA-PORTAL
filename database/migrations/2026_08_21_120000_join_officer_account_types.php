<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Reviewing Officer and Compliance Officer become one assignable account
 * type: "CRO / Reviewing officer". CIP still distinguishes reviewing vs
 * compliance as jobs on an application; the account type that may hold
 * either job is now the same.
 */
return new class extends Migration
{
    private const FROM = ['Reviewing Officer', 'Compliance Officer'];

    private const TO = 'CRO / Reviewing officer';

    public function up(): void
    {
        DB::table('users')
            ->whereIn('account_type', self::FROM)
            ->update(['account_type' => self::TO]);

        if (Schema::hasTable('invitations')) {
            DB::table('invitations')
                ->whereIn('role', self::FROM)
                ->update(['role' => self::TO]);
        }
    }

    public function down(): void
    {
        // Ambiguous — both legacy types mapped onto one value. Prefer the
        // reviewing-officer spelling so a rollback does not invent compliance
        // accounts that never existed after the join.
        DB::table('users')
            ->where('account_type', self::TO)
            ->update(['account_type' => 'Reviewing Officer']);

        if (Schema::hasTable('invitations')) {
            DB::table('invitations')
                ->where('role', self::TO)
                ->update(['role' => 'Reviewing Officer']);
        }
    }
};
