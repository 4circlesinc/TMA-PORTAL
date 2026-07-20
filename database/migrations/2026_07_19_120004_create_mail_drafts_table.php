<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The compose dock keeps several windows open at once, so drafts are
        // rows rather than a single scratch record. They autosave locally and
        // push to the provider so the same draft appears in Gmail/Outlook.
        Schema::create('mail_drafts', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connected_account_id')->constrained()->cascadeOnDelete();

            $table->string('remote_id')->nullable();
            $table->json('to')->nullable();
            $table->json('cc')->nullable();
            $table->json('bcc')->nullable();
            $table->string('subject', 998)->nullable();
            $table->longText('body_html')->nullable();

            // new | reply | reply-all | forward, plus the message being
            // answered so the provider can thread it correctly.
            $table->string('mode', 20)->default('new');
            $table->string('in_reply_to')->nullable();
            $table->string('thread_id')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_drafts');
    }
};
