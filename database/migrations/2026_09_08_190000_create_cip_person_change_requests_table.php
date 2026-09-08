<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A proposed correction to a person on a post-approval file.
 *
 * Post-approval details are the firm's to keep right, but not everyone's to
 * change unilaterally: an employee or the service provider proposes, an
 * administrator approves, and only then does the value move. Administrators
 * edit directly and never write a row here.
 *
 * One row per proposal rather than per field, because a correction is usually
 * a set of them ("this whole person was entered from the wrong passport") and
 * approving half of that is not a thing anybody wants to do. `changes` holds
 * the field => new value map; `before` holds what those fields said when the
 * request was made, so an approver can see the diff and a stale request can
 * be spotted rather than silently overwriting newer work.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_person_change_requests', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('person_id')->constrained('cip_people')->cascadeOnDelete();
            $table->foreignId('requested_by')->constrained('users')->cascadeOnDelete();
            $table->json('changes');
            $table->json('before')->nullable();
            $table->text('note')->nullable();

            // pending | approved | declined
            $table->string('status', 16)->default('pending');
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->text('decision_note')->nullable();

            $table->timestamps();

            // The open-requests badge asks this question on every file read.
            $table->index(['application_id', 'status']);
            $table->index(['person_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_person_change_requests');
    }
};
