<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Conversations about a client: the Message button on an applicant can open
 * a thread with the service provider about that person, or a private DM with
 * the person themselves when they have a portal login.
 *
 * `client_id` is the applicant the thread belongs to — the profile tab and
 * call recordings key off it. `company_id` is the service provider when the
 * conversation is with that firm rather than with the applicant. `subject`
 * distinguishes the two so a private DM and the case thread can coexist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            if (! Schema::hasColumn('conversations', 'client_id')) {
                $table->foreignId('client_id')->nullable()->after('created_by')
                    ->constrained('clients')->nullOnDelete();
            }
            if (! Schema::hasColumn('conversations', 'company_id')) {
                $table->foreignId('company_id')->nullable()->after('client_id')
                    ->constrained('companies')->nullOnDelete();
            }
            if (! Schema::hasColumn('conversations', 'cip_application_id')) {
                $table->foreignId('cip_application_id')->nullable()->after('company_id')
                    ->constrained('cip_applications')->nullOnDelete();
            }
            if (! Schema::hasColumn('conversations', 'subject')) {
                $table->string('subject', 16)->nullable()->after('cip_application_id');
            }

            if (! Schema::hasIndex('conversations', ['client_id', 'subject'])) {
                $table->index(['client_id', 'subject']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            if (Schema::hasIndex('conversations', ['client_id', 'subject'])) {
                $table->dropIndex(['client_id', 'subject']);
            }
            if (Schema::hasColumn('conversations', 'cip_application_id')) {
                $table->dropConstrainedForeignId('cip_application_id');
            }
            if (Schema::hasColumn('conversations', 'company_id')) {
                $table->dropConstrainedForeignId('company_id');
            }
            if (Schema::hasColumn('conversations', 'client_id')) {
                $table->dropConstrainedForeignId('client_id');
            }
            if (Schema::hasColumn('conversations', 'subject')) {
                $table->dropColumn('subject');
            }
        });
    }
};
