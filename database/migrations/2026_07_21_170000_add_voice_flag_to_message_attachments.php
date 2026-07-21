<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Marks an attachment as a recorded voice note.
     *
     * Neither the extension nor the sniffed MIME can be trusted to tell one
     * apart: MediaRecorder produces an audio-only **WebM**, and `webm` maps to
     * *video* in the File Library's type table, so a voice note would arrive
     * looking like a video and render with a video player.
     *
     * A voice note is also a different thing from an attached audio file — it
     * gets a waveform and transport UI rather than a download tile, and it
     * should not clutter the shared-documents shelf — so the distinction is
     * recorded rather than guessed.
     */
    public function up(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->boolean('is_voice')->default(false)->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->dropColumn('is_voice');
        });
    }
};
