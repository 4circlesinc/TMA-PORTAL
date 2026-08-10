<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recordings of calls between staff and clients (§ CallRecordingController).
 *
 * One row per recorded call. The row is created the moment recording is
 * arranged (status `recording`), fed by sequenced chunk uploads while the
 * call runs, and settled by the finish call (status `ready`, or `failed`).
 * A row that never reaches finish — a crashed browser mid-call — keeps
 * whatever chunks landed and is shown as interrupted by the listing.
 *
 * `client_id` may be null: the client linkage is resolved from the portal
 * account (clients.user_id) at record time, and a client account that has no
 * clients-table row yet still gets its call recorded.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('call_recordings', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('client_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('recorded_by')->constrained('users')->cascadeOnDelete();

            // Denormalised on purpose: who was on the call, as they were named
            // at the time. Accounts get renamed and deleted; the record of a
            // call must not change underneath the firm.
            $table->json('participants');
            $table->string('client_name');

            $table->string('media', 10)->default('audio');
            $table->string('status', 20)->default('recording');

            // Where the bytes live once assembled — read from the ROW, never
            // from config, so recordings survive a FILES_DISK switch.
            $table->string('disk', 40)->nullable();
            $table->string('path')->nullable();
            $table->string('mime', 100)->nullable();
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedInteger('duration_ms')->default(0);

            // Highest chunk sequence written, so a retried upload of a chunk
            // that already landed is recognised and skipped.
            $table->integer('last_seq')->default(-1);

            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index(['client_id', 'started_at']);
            $table->index('started_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('call_recordings');
    }
};
