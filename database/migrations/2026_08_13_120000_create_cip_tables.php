<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * CIP (Citizenship by Investment) native domain layer — Phase 1.
     *
     * These are the portal-owned tables that replace the read-only Smartsheet
     * mirror (cbi_*). The mirror's sync bulk-upserts its own columns every ten
     * minutes, so nothing here may share a table with it: portal-authored
     * workflow state lives only in cip_* rows the sync never touches.
     */
    public function up(): void
    {
        /*
         * Service Provider firms — and the reserved PRI bucket for private
         * clients. The provider code prefixes every internal application
         * number (GAL26-00001), so codes are unique and immutable in spirit:
         * the registry is the one place they are defined.
         */
        Schema::create('cip_providers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('name', 191);
            $table->string('code', 8)->unique();
            // The referral-source company the CBI importer registered, when
            // one exists. Kept nullable: a provider is real without a company
            // row, and CIP config deliberately does not widen `companies`.
            $table->foreignId('company_id')->nullable()->constrained('companies')->nullOnDelete();
            $table->string('contact_name', 191)->nullable();
            $table->string('contact_email', 191)->nullable();
            // Extra notification recipients beyond the contact, if the firm
            // wants a shared inbox per provider.
            $table->jsonb('notification_emails')->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });

        /*
         * One application = one citizenship file. Workflow dates are columns
         * because the brief names each of them as the trigger that flips the
         * status (query received → NON-COMPLIANT, accepted → BACKGROUND
         * CHECK, decision → GRANTED/DENIED).
         */
        Schema::create('cip_applications', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('provider_id')->constrained('cip_providers')->restrictOnDelete();
            // The main applicant's client-hub record (auto-created at
            // application creation from Phase 2 on). Applications survive a
            // client purge; the profile join just goes away.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('status', 32)->default('draft')->index();
            $table->string('investment_type', 64)->nullable();
            $table->string('investment_type_other', 191)->nullable();

            /*
             * Dual numbering. The internal number is minted in the same
             * transaction as the insert and never changes; the government CIP
             * number arrives at submission and takes over display only —
             * displayNumber() on the model is the single switch point.
             */
            $table->string('internal_number', 20)->nullable()->unique();
            $table->string('cip_number', 32)->nullable()->unique();

            // Denormalized cache of the live assignment — written only by the
            // engine; cip_application_assignments is the authority.
            $table->foreignId('assigned_officer_id')->nullable()->constrained('users')->nullOnDelete();
            // Who at the government Unit handles this file ("internally it
            // would be Dominic, externally Kevin").
            $table->string('unit_contact', 191)->nullable();

            $table->date('submitted_at')->nullable();
            $table->date('query_received_at')->nullable();
            $table->date('accepted_at')->nullable();
            $table->date('decided_at')->nullable();
            $table->string('decision', 16)->nullable();
            // The original submission package freezes at CONFIRM SUBMISSION.
            $table->timestamp('locked_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['provider_id', 'status']);
            $table->index('assigned_officer_id');
        });

        /*
         * Every individual on an application — main applicant, sponsor,
         * dependents — each with their own document repository (Phase 2).
         * Qualified-dependent ordinals are computed from age, never typed.
         */
        Schema::create('cip_people', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->string('role', 16); // main_applicant | sponsor | dependent
            $table->string('relationship', 24)->nullable(); // spouse | qualified_dependent
            $table->unsignedSmallInteger('dependent_ordinal')->nullable();
            $table->string('first_name', 191)->nullable();
            $table->string('last_name', 191)->nullable();
            $table->string('gender', 16)->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('country_of_birth', 191)->nullable();
            $table->string('country_of_residence', 191)->nullable();
            // Derived from country of residence, never asked.
            $table->string('region', 64)->nullable();
            $table->string('occupation', 191)->nullable();
            $table->string('passport_number', 64)->nullable();
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['application_id', 'role']);
        });

        /*
         * Officer assignment — the authority. Ends rather than deletes, the
         * same shape as client assignments, so history survives and AccessSync
         * can settle live rows on suspension.
         */
        Schema::create('cip_application_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 32)->default('reviewing_officer');
            $table->string('status', 16)->default('active');
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['application_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        /*
         * Append-only compliance audit. This is CIP-owned on purpose:
         * activity_logs is hard-pruned per user retention preference (default
         * 30 days), and a citizenship file's history must never evaporate.
         * Rows are written inside the same transaction as the change they
         * record, and nothing updates or deletes them.
         */
        Schema::create('cip_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete(); // null = system
            $table->string('action', 40);
            $table->string('from_status', 32)->nullable();
            $table->string('to_status', 32)->nullable();
            $table->text('detail')->nullable();
            $table->jsonb('meta')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['application_id', 'created_at']);
        });

        /*
         * Per-user officer grants. Account types stay Client/Employee/
         * Administrator; being a CRO or Compliance Officer is a grant read by
         * CipAccess, not a fourth account type.
         */
        Schema::create('cip_officer_roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 32); // reviewing_officer | compliance_officer
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'role']);
        });

        /*
         * Internal-number sequences, one row per (provider, year), advanced
         * under a row lock so parallel creates cannot mint the same number.
         * Never read outside Numbering::next().
         */
        Schema::create('cip_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('provider_id')->constrained('cip_providers')->cascadeOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_sequence')->default(0);
            $table->timestamps();

            $table->unique(['provider_id', 'year']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_counters');
        Schema::dropIfExists('cip_officer_roles');
        Schema::dropIfExists('cip_events');
        Schema::dropIfExists('cip_application_assignments');
        Schema::dropIfExists('cip_people');
        Schema::dropIfExists('cip_applications');
        Schema::dropIfExists('cip_providers');
    }
};
