<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * CBI (Citizenship by Investment) domain layer.
     *
     * One application = one citizenship file, regardless of how many
     * Smartsheet tracker rows describe it. The same person appears on the
     * master tracker, then the COR/NIC/passport trackers, then a closed
     * sheet — those rows all merge into a single application here via a
     * dedupe key, with cbi_application_sources recording every feeding row
     * so the merge is auditable and reversible.
     *
     * Columns exist for what the UI filters, sorts, or displays prominently.
     * Everything else the trackers carry survives in two JSON bags
     * (`financials`, `extra`) — imported for completeness, not painted.
     */
    public function up(): void
    {
        Schema::create('cbi_applications', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            /*
             * Merge identity. Normalised applicant number when present,
             * else normalised name + date of birth. Ambiguous rows refuse
             * to merge and flag needs_review instead — a wrong merge of two
             * real applicants is far worse than a duplicate card.
             */
            $table->string('dedupe_key', 191)->nullable()->index();
            $table->boolean('needs_review')->default(false);

            // Applicant
            $table->string('applicant_number', 191)->nullable()->index();
            $table->string('applicant_name', 512)->nullable();
            $table->string('main_applicant_name', 512)->nullable();
            $table->date('date_of_birth')->nullable();
            $table->string('nationality', 191)->nullable();
            $table->unsignedSmallInteger('number_of_dependents')->nullable();
            $table->text('family_structure')->nullable();
            $table->text('contact_details')->nullable();

            // Workflow. Stage is the portal's four-lane pipeline; status and
            // progress are Smartsheet's own labels, kept verbatim for filters.
            $table->string('stage', 24)->default('applications')->index();
            // applications | assessment | tracker | closed
            $table->string('status', 64)->nullable()->index();
            $table->string('application_review', 64)->nullable();
            $table->string('progress', 64)->nullable();
            $table->boolean('granted')->default(false);
            $table->boolean('closed')->default(false);
            $table->string('action_needed', 16)->nullable();

            // People
            $table->string('referred_by', 191)->nullable()->index();
            $table->string('promoter', 191)->nullable();
            $table->string('service_provider', 191)->nullable();
            $table->string('main_contact', 191)->nullable();
            $table->string('assigned_to', 191)->nullable()->index();
            $table->string('verification_officer', 191)->nullable();
            $table->string('dd_officer', 191)->nullable();
            $table->string('pa_assignment', 191)->nullable();
            $table->string('file_owner', 191)->nullable();
            $table->string('submitted_by', 64)->nullable();
            $table->string('verified_by', 64)->nullable();
            // Portal staff member, once matched — the Smartsheet names above
            // stay as imported until account matching is wired.
            $table->foreignId('assigned_user_id')->nullable()->constrained('users')->nullOnDelete();

            // Case
            $table->string('investment_option', 64)->nullable()->index();
            $table->string('application_type', 64)->nullable();
            $table->string('clio_matter_number', 191)->nullable();
            $table->string('clio_matter_link', 512)->nullable();
            $table->string('file_location', 191)->nullable();

            // Pre-approval timeline
            $table->date('received_at')->nullable()->index();
            $table->date('pre_processing_at')->nullable();
            $table->date('submitted_at')->nullable();
            $table->date('accepted_at')->nullable();
            $table->date('compliance_due_at')->nullable();
            $table->date('decision_required_at')->nullable();
            $table->date('decision_received_at')->nullable();

            // Post-approval timeline
            $table->date('cor_submitted_at')->nullable();
            $table->date('cor_received_at')->nullable();
            $table->string('cor_number', 191)->nullable();
            $table->date('nic_request_sent_at')->nullable();
            $table->date('nic_letter_received_at')->nullable();
            $table->date('passport_pads_received_at')->nullable();
            $table->date('ready_for_passport_submission_at')->nullable();
            $table->date('passport_submitted_at')->nullable();
            $table->date('passport_received_at')->nullable();
            $table->string('passport_number', 191)->nullable();
            $table->date('originals_delivered_at')->nullable();
            $table->date('final_documents_sent_at')->nullable();

            // Appeals
            $table->date('appeal_requested_at')->nullable();
            $table->date('appeal_sent_at')->nullable();
            $table->date('appeal_decided_at')->nullable();

            // Narrative
            $table->text('notes')->nullable();
            $table->text('latest_comment')->nullable();
            $table->text('issues_log')->nullable();
            $table->text('agent_assessment')->nullable();
            $table->text('assessment_response')->nullable();

            // Everything money-shaped (invoice numbers, amounts, paid flags)
            // and every remaining populated column, keyed by column title.
            $table->json('financials')->nullable();
            $table->json('extra')->nullable();

            /*
             * Primary source row — the one that currently authors this
             * application (highest-priority sheet it appears on). All
             * feeding rows, including this one, live in
             * cbi_application_sources.
             */
            $table->unsignedBigInteger('source_sheet_remote_id')->nullable();
            $table->unsignedBigInteger('source_row_remote_id')->nullable();
            $table->string('source_permalink', 512)->nullable();
            $table->timestamp('source_modified_at')->nullable();

            $table->timestamp('first_imported_at')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['stage', 'status']);
            $table->index(['source_sheet_remote_id', 'source_row_remote_id']);
        });

        Schema::create('cbi_application_sources', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cbi_applications')->cascadeOnDelete();
            $table->unsignedBigInteger('sheet_remote_id');
            $table->unsignedBigInteger('row_remote_id');
            $table->string('sheet_name', 512)->nullable();
            $table->string('sheet_category', 24)->nullable();
            $table->timestamp('row_modified_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            // A tracker row feeds exactly one application — the merge's
            // anti-duplicate guarantee, enforced by the database.
            $table->unique(['sheet_remote_id', 'row_remote_id']);
            $table->index('application_id');
        });

        Schema::create('cbi_application_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cbi_applications')->cascadeOnDelete();
            // imported | stage_changed | status_changed | field_changed |
            // comment_added | note | assigned | attachment_added
            $table->string('type', 32);
            $table->string('field', 64)->nullable();
            $table->text('from_value')->nullable();
            $table->text('to_value')->nullable();
            // smartsheet | portal | system — every change attributable to a
            // user or to the sync, never anonymous.
            $table->string('source', 16)->default('system');
            $table->string('actor_name', 191)->nullable();
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('meta')->nullable();
            $table->timestamp('occurred_at')->nullable();
            $table->timestamps();

            $table->index(['application_id', 'occurred_at']);
            $table->index(['application_id', 'type']);
        });

        Schema::create('cbi_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('application_id')->constrained('cbi_applications')->cascadeOnDelete();
            // portal comments carry a user; imported Smartsheet comments only
            // have the author's name/email as Smartsheet recorded them.
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('author_name', 191)->nullable();
            $table->string('author_email', 320)->nullable();
            $table->text('body');
            $table->string('source', 16)->default('portal'); // portal | smartsheet
            $table->unsignedBigInteger('smartsheet_comment_remote_id')->nullable()->unique();
            $table->unsignedBigInteger('smartsheet_discussion_remote_id')->nullable();
            $table->timestamp('commented_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['application_id', 'commented_at']);
        });

        Schema::create('cbi_assessment_items', function (Blueprint $table) {
            $table->id();
            // Nullable: an assessment sheet that hasn't matched an
            // application yet still imports; it attaches when matching runs.
            $table->foreignId('application_id')->nullable()->constrained('cbi_applications')->nullOnDelete();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('row_remote_id');
            $table->unsignedBigInteger('parent_row_remote_id')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->string('applicant_label', 512)->nullable();
            $table->text('description')->nullable();
            $table->text('notes')->nullable();
            $table->text('agent_assessment')->nullable();
            $table->text('assessment_response')->nullable();
            $table->boolean('is_done')->default(false);
            $table->timestamp('row_modified_at')->nullable();
            $table->timestamps();

            $table->unique(['sheet_id', 'row_remote_id']);
            $table->index(['application_id', 'position']);
        });

        // Deferred from smartsheet_sheets: cbi_applications didn't exist yet.
        Schema::table('smartsheet_sheets', function (Blueprint $table) {
            $table->foreign('cbi_application_id')
                ->references('id')->on('cbi_applications')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('smartsheet_sheets', fn (Blueprint $t) => $t->dropForeign(['cbi_application_id']));
        Schema::dropIfExists('cbi_assessment_items');
        Schema::dropIfExists('cbi_comments');
        Schema::dropIfExists('cbi_application_events');
        Schema::dropIfExists('cbi_application_sources');
        Schema::dropIfExists('cbi_applications');
    }
};
