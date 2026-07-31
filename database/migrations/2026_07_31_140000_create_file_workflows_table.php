<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sending a file for feedback, review, approval or acknowledgement.
     *
     * Signature requests are NOT duplicated here: the portal already has a
     * working signing engine (signature_requests and friends), and stretching
     * this schema to carry signing would risk regressing it. A workflow of type
     * `signature` therefore delegates, holding only a pointer to the request it
     * created — wired up in the next phase.
     *
     * The load-bearing column is `file_version_id`. A workflow reviews a
     * specific revision, never "the file" in the abstract: without that, someone
     * uploading a new version mid-review would silently change what the
     * approvers are agreeing to, which §6 forbids.
     */
    public function up(): void
    {
        Schema::create('file_workflows', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('file_id')->constrained('files')->cascadeOnDelete();
            // The exact revision under review. Kept even after newer versions
            // exist, so history can always say what was actually approved.
            $table->foreignId('file_version_id')->nullable()
                ->constrained('file_versions')->nullOnDelete();

            $table->string('type', 24);              // feedback|review|approval|acknowledgement|signature
            $table->string('status', 32);

            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->text('message')->nullable();

            $table->timestamp('due_at')->nullable();

            // Everyone must respond, or the first response settles it.
            $table->boolean('require_all')->default(true);
            // Participants are asked one at a time, in `position` order.
            $table->boolean('ordered')->default(false);
            // A response with no words is not feedback.
            $table->boolean('require_comment')->default(false);
            // Refuse new versions while this is open, rather than letting the
            // content move under the reviewers.
            $table->boolean('lock_file')->default(false);

            // Days between reminder emails; null = no reminders.
            $table->unsignedSmallInteger('reminder_days')->nullable();

            // Set when a newer version is uploaded while this is still open.
            // The workflow deliberately stays on its own version; this records
            // that it no longer describes the file's current content.
            $table->foreignId('superseded_by_version_id')->nullable()
                ->constrained('file_versions')->nullOnDelete();

            // Populated for type=signature; the signing engine owns the rest.
            $table->foreignId('signature_request_id')->nullable()
                ->constrained('signature_requests')->nullOnDelete();

            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['file_id', 'status']);
            $table->index(['status', 'due_at']);
        });

        Schema::create('file_workflow_steps', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('workflow_id')->constrained('file_workflows')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            // Kept alongside user_id so history still names the person after an
            // account is removed.
            $table->string('email')->nullable();
            $table->string('name')->nullable();

            $table->string('role', 24);              // reviewer|approver|signer|acknowledger
            // Position drives ordered flows; parallel flows share position 1.
            $table->unsignedSmallInteger('position')->default(1);

            $table->string('status', 32)->default('pending');
            $table->timestamp('invited_at')->nullable();
            $table->timestamp('responded_at')->nullable();
            $table->text('comment')->nullable();

            // A step handed to somebody else keeps pointing at who took it on.
            $table->foreignId('delegated_to_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('delegated_from_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('last_reminded_at')->nullable();
            $table->unsignedSmallInteger('reminder_count')->default(0);

            $table->timestamps();

            $table->index(['workflow_id', 'position']);
            $table->index(['user_id', 'status']);
        });

        /**
         * The audit trail: who did what, when, and why. Separate rows rather
         * than a JSON blob on the workflow, so "everything that happened to
         * this document" stays queryable and orderable.
         */
        Schema::create('file_workflow_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('workflow_id')->constrained('file_workflows')->cascadeOnDelete();
            $table->foreignId('step_id')->nullable()->constrained('file_workflow_steps')->nullOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('action', 40);
            $table->text('detail')->nullable();
            $table->json('meta')->nullable();

            $table->timestamp('created_at')->nullable();

            $table->index(['workflow_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_workflow_events');
        Schema::dropIfExists('file_workflow_steps');
        Schema::dropIfExists('file_workflows');
    }
};
