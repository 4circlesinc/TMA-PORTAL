<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Files sent in a conversation: images, documents, video, and voice notes.
     *
     * Stored the same way the File Library stores its files - the disk is saved
     * per row rather than assumed, so rows written while the portal was on the
     * local disk keep resolving after the switch to R2.
     *
     * Bytes are never served from a public URL. The download route re-checks
     * conversation membership on every request.
     */
    public function up(): void
    {
        Schema::create('message_attachments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();

            $table->string('disk', 32);
            $table->string('path');
            // The name as uploaded, shown in the bubble and used for download.
            $table->string('name');
            $table->string('mime', 191)->nullable();
            $table->unsignedBigInteger('size')->default(0);

            // Set for images and video; lets the bubble reserve the right box
            // before the file loads, so the thread doesn't jump while scrolling.
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            // Audio and video length. Also the voice note's displayed duration.
            $table->unsignedInteger('duration_ms')->nullable();
            // Generated poster for video and large images.
            $table->string('thumb_path')->nullable();
            // Precomputed waveform peaks for a voice note, so playback can draw
            // the bar chart without decoding the audio client-side.
            $table->jsonb('waveform')->nullable();

            $table->timestamps();

            $table->index('message_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_attachments');
    }
};
