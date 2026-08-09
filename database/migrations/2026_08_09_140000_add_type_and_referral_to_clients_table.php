<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Two things the directory could not say before.
     *
     * `client_type` is what the record *is*: a private individual, or a
     * company applying in its own name.
     *
     * The referral columns are who sent them to the firm, which is a different
     * relationship from `company_id` (the organisation a contact belongs to)
     * and deliberately kept apart from it: a company that refers somebody must
     * not thereby acquire them as a member, nor the file access and staff
     * assignment reach that membership carries.
     *
     * `referral_type` is stored rather than derived because "Private" and "not
     * recorded" are different answers — one says the client came in on their
     * own, the other says nobody has filled it in yet — and a nullable
     * foreign key alone cannot tell them apart.
     */
    public function up(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->string('client_type', 16)->default('private')->after('name');
            $table->string('referral_type', 16)->default('none')->after('company_id');
            $table->foreignId('referred_by_company_id')->nullable()->after('referral_type')
                ->constrained('companies')->nullOnDelete();

            $table->index('client_type');
            $table->index('referral_type');
            $table->index('referred_by_company_id');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropConstrainedForeignId('referred_by_company_id');
            $table->dropIndex(['client_type']);
            $table->dropIndex(['referral_type']);
            $table->dropColumn(['client_type', 'referral_type']);
        });
    }
};
