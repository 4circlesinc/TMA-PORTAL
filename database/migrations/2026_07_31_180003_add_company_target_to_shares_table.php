<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Lets a file or folder be shared with a *company* rather than with a list of
 * people.
 *
 * Without this, giving twelve people at a client access meant twelve share rows
 * — and the thirteenth person to join got nothing until somebody remembered.
 * A company share is one row that every current member resolves against, so
 * joining grants access and being removed takes it away, with no share rows to
 * maintain. It is also what lets the Manage Access panel say "Everyone at Acme
 * Group" instead of listing twelve names.
 *
 * `target_company_role` narrows it further: null means every member, otherwise
 * only members holding that company role — "Company finance contacts".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shares', function (Blueprint $table) {
            $table->foreignId('target_company_id')->nullable()->after('target_email')
                ->constrained('companies')->cascadeOnDelete();
            $table->string('target_company_role', 24)->nullable()->after('target_company_id');

            $table->index('target_company_id');
        });
    }

    public function down(): void
    {
        Schema::table('shares', function (Blueprint $table) {
            $table->dropConstrainedForeignId('target_company_id');
            $table->dropColumn('target_company_role');
        });
    }
};
