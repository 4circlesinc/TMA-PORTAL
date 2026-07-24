<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Durable mailbox synchronization progress, one row per connected account.
 *
 * Progress used to live only in the frontend (a poll of message counts), so a
 * refresh, a closed tab or a dead worker left the user staring at a spinner
 * with no way to know what was happening. This survives all of that: stages,
 * totals, failure detail and retry bookkeeping are all server-side.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_sync_progress', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connected_account_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('provider', 20);

            // pending | running | completed | failed
            $table->string('status', 20)->default('pending');
            $table->string('current_stage', 40)->default('connecting');
            $table->string('current_folder', 20)->nullable();

            // Provider-reported totals arrive within seconds of connecting;
            // until the import finishes they are labelled as estimates.
            $table->boolean('totals_estimated')->default(true);
            $table->unsignedInteger('total_messages')->nullable();
            $table->unsignedInteger('processed_messages')->default(0);
            $table->unsignedInteger('total_conversations')->nullable();
            $table->unsignedInteger('total_attachments')->nullable();
            $table->unsignedInteger('processed_attachments')->default(0);
            $table->unsignedInteger('total_images')->nullable();
            $table->unsignedInteger('total_documents')->nullable();
            $table->unsignedInteger('failed_messages')->default(0);
            $table->unsignedInteger('failed_attachments')->default(0);
            $table->unsignedTinyInteger('percentage')->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('last_progress_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('last_retry_at')->nullable();

            // A short machine code (auth, rate-limit, queue, …) plus the
            // human sentence the panel shows; the raw detail goes to logs.
            $table->string('error_code', 40)->nullable();
            $table->text('error_message')->nullable();

            // Resume points, so a retried batch continues instead of
            // restarting. Graph nextLinks / delta tokens are long URLs.
            $table->text('next_link')->nullable();
            $table->text('delta_link')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_sync_progress');
    }
};
