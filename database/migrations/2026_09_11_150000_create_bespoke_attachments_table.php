<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Files a reader drops into a Bespoke AI chat: a PDF to summarise, a photo
 * to make into a 2×2. Up to five per message. `text` is what the browser
 * read out of a PDF (pdf.js) or what a plain-text file holds, so the model
 * can quote it; the bytes live on the files disk under the row's own path.
 * A row with no message_id was uploaded and never sent; those are pruned.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bespoke_attachments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('conversation_id')->constrained('bespoke_conversations')->cascadeOnDelete();
            $table->foreignId('message_id')->nullable()->constrained('bespoke_messages')->nullOnDelete();
            $table->string('kind', 16)->default('upload');
            $table->string('name', 180);
            $table->string('mime', 120)->nullable();
            $table->string('extension', 16)->default('');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('disk', 32);
            $table->string('path', 255);
            $table->boolean('encrypted')->default(false);
            $table->string('checksum', 64)->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->unsignedInteger('pages')->nullable();
            $table->longText('text')->nullable();
            $table->timestamps();

            $table->index(['conversation_id', 'message_id']);
            $table->index(['user_id', 'message_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bespoke_attachments');
    }
};
