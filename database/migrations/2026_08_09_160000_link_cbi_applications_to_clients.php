<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The join between a citizenship file and the firm's client directory.
     *
     * It lives on the application rather than the client because that is the
     * side that is one-to-one: an application describes exactly one applicant,
     * while a person in the hub may hold several files over the years.
     *
     * It is also what makes the import idempotent — an application that
     * already points at a client is skipped rather than duplicated — so the
     * importer can be re-run after every Smartsheet sync.
     */
    public function up(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            $table->foreignId('client_id')->nullable()->after('assigned_user_id')
                ->constrained('clients')->nullOnDelete();
            $table->index('client_id');
        });
    }

    public function down(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('client_id');
        });
    }
};
