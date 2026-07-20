<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mail_messages', function (Blueprint $table) {
            $table->id();
            // Public addressing, like files/folders — provider ids never
            // appear in a URL the browser can see.
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connected_account_id')->constrained()->cascadeOnDelete();

            $table->string('remote_id');
            $table->string('thread_id')->nullable();
            // inbox | sent | draft | spam | trash | archive
            $table->string('folder', 20)->default('inbox');

            $table->string('subject', 998)->nullable();
            $table->text('snippet')->nullable();
            // Bodies are fetched lazily on first open and cached here; syncing
            // every body up front would be slow and mostly wasted.
            $table->longText('body_html')->nullable();
            $table->longText('body_text')->nullable();

            $table->string('from_name')->nullable();
            $table->string('from_email')->nullable();
            $table->json('to')->nullable();
            $table->json('cc')->nullable();
            $table->json('bcc')->nullable();
            $table->string('reply_to')->nullable();

            $table->boolean('is_read')->default(false);
            $table->boolean('is_starred')->default(false);
            $table->boolean('is_important')->default(false);
            $table->boolean('has_attachments')->default(false);

            $table->timestamp('sent_at')->nullable();
            $table->timestamps();

            // One row per provider message, per connected mailbox.
            $table->unique(['connected_account_id', 'remote_id']);
            // The list query: a user's folder, newest first.
            $table->index(['user_id', 'folder', 'sent_at']);
            $table->index(['user_id', 'thread_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_messages');
    }
};
