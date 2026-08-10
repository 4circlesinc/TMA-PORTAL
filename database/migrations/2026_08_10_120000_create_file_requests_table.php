<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Requesting documents from somebody who has no portal account.
 *
 * A request is a secure, one-way inbox: the recipient opens a link, drops
 * files in, and never sees anything else in the workspace. It is deliberately
 * NOT a `shares` row — a share hands out read access to something that already
 * exists, whereas this hands out *write* access to one destination and nothing
 * else. Overloading the shares table would have meant an `allow_download`
 * column that must never be true and a `role` that means nothing.
 *
 * The destination is a folder id, or null for the requester's File Box. The
 * folder is resolved once, at creation, against the requester's own
 * permissions; the public route never takes a destination from the visitor.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_requests', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            // The public link. Long and random — everything the visitor can do
            // is keyed off this and nothing else is exposed.
            $table->string('token', 64)->unique();

            $table->string('title');
            $table->text('message')->nullable();

            // Destination. nullOnDelete rather than cascade: deleting a folder
            // must not silently delete the record of what was asked for.
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();

            $table->string('recipient_email')->nullable();
            $table->string('recipient_name')->nullable();

            // Null means "whatever the library accepts" — FileType still
            // rejects executables and MIME spoofing regardless of this list.
            $table->jsonb('allowed_extensions')->nullable();
            $table->unsignedBigInteger('max_bytes')->nullable();
            $table->unsignedInteger('max_files')->default(20);
            $table->boolean('allow_multiple')->default(true);

            $table->string('password_hash')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('revoked_at')->nullable();

            $table->unsignedInteger('upload_count')->default(0);
            $table->timestamp('last_upload_at')->nullable();
            $table->timestamp('opened_at')->nullable();

            $table->timestamps();

            $table->index('created_by');
            $table->index('folder_id');
            $table->index('client_id');
        });

        Schema::create('file_request_uploads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_request_id')->constrained('file_requests')->cascadeOnDelete();
            // The file may later be deleted from the library; the record of it
            // having arrived should outlive that.
            $table->foreignId('file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->string('name');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('uploader_name')->nullable();
            $table->string('uploader_email')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestamps();

            $table->index('file_request_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('file_request_uploads');
        Schema::dropIfExists('file_requests');
    }
};
