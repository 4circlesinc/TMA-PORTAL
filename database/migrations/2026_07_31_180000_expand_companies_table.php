<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Turns a company from a name-and-website note into a real account record.
 *
 * The Client hub could already group contacts under a company, but the company
 * itself held nothing you could invoice, address or file against — so anything
 * that belonged to the organization rather than to one person had nowhere to
 * live. Everything here is optional: an existing company with only a name stays
 * valid, and staff fill the rest in when they have it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->string('logo_url')->nullable()->after('name');
            // limited_company | partnership | sole_trader | non_profit | government | other
            $table->string('company_type', 32)->nullable()->after('logo_url');
            $table->string('registration_number', 64)->nullable()->after('company_type');
            $table->string('tax_number', 64)->nullable()->after('registration_number');
            $table->string('industry', 120)->nullable()->after('tax_number');

            $table->string('email')->nullable()->after('website');
            $table->string('phone', 64)->nullable()->after('email');

            // The postal address, and the billing details, as structured blobs
            // — both are irregular enough across jurisdictions that columns
            // would be wrong more often than right.
            $table->jsonb('address')->nullable()->after('phone');
            $table->jsonb('billing')->nullable()->after('address');

            // active | prospect | archived
            $table->string('status', 16)->default('active')->after('billing');

            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->dropColumn([
                'logo_url', 'company_type', 'registration_number', 'tax_number',
                'industry', 'email', 'phone', 'address', 'billing', 'status',
            ]);
        });
    }
};
