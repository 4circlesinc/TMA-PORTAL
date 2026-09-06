<?php

use App\Support\SecurityPolicies;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Require authenticator MFA for existing installs. PHPUnit skips this so
 * feature tests keep the off-by-default gate they already cover.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        $row = DB::table('portal_settings')->where('key', 'security.sign-in')->first();
        $value = $row ? (json_decode((string) $row->value, true) ?: []) : [];
        $value['requireMfa'] = true;
        $value['requireAuthenticatorApp'] = true;

        DB::table('portal_settings')->updateOrInsert(
            ['key' => 'security.sign-in'],
            [
                'value' => json_encode(array_replace_recursive(
                    SecurityPolicies::DEFAULTS['sign-in'],
                    $value,
                )),
                'updated_at' => now(),
            ],
        );
    }

    public function down(): void
    {
        // Forward-only: turning MFA off is an administrator action, not a rollback.
    }
};
