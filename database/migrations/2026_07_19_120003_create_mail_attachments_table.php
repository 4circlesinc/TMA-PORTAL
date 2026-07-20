<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Metadata only. The bytes stay at the provider and stream through
        // the download route on demand — mirroring every mailbox into R2
        // would be a large, mostly-unread copy of someone else's storage.
        Schema::create('mail_attachments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('mail_message_id')->constrained()->cascadeOnDelete();

            $table->string('remote_id')->nullable();
            $table->string('filename');
            $table->string('mime_type')->nullable();
            $table->unsignedBigInteger('size')->default(0);
            // Inline images referenced by the body via cid: — not shown in
            // the attachment strip.
            $table->boolean('is_inline')->default(false);
            $table->string('content_id')->nullable();
            $table->timestamps();

            $table->index('mail_message_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_attachments');
    }
};
