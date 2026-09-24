<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which upload a derived file was made from.
 *
 * A 2×2 crop is cut from a photo the reader dropped in, and until now the
 * result kept no link back to it. That was fine while the editor only ever
 * existed in the turn that made it — but a reopened chat has to be able to
 * offer Adjust, and re-framing means going back to the ORIGINAL pixels, not
 * re-cropping the crop, which would lose a little more of the picture every
 * time and eventually soften it to nothing.
 *
 * Null for an ordinary upload. Null too if the source is ever deleted: the
 * crop stays, it simply can no longer be re-framed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bespoke_attachments', function (Blueprint $table) {
            $table->foreignId('source_id')
                ->nullable()
                ->after('message_id')
                ->constrained('bespoke_attachments')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('bespoke_attachments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('source_id');
        });
    }
};
