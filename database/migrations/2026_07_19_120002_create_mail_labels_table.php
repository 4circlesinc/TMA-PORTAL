<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Gmail has labels natively. Graph has no equivalent — Outlook
        // categories are the closest match, so the Graph provider maps these
        // onto categories and the portal keeps its own copy either way.
        Schema::create('mail_labels', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('connected_account_id')->constrained()->cascadeOnDelete();

            $table->string('remote_id')->nullable();
            $table->string('name');
            // Matches the tone names the email UI already renders.
            $table->string('tone', 20)->default('gray');
            // System labels (INBOX, SENT, …) drive folders, not the label chips.
            $table->boolean('is_system')->default(false);
            $table->timestamps();

            $table->unique(['connected_account_id', 'remote_id']);
            $table->index(['user_id', 'is_system']);
        });

        Schema::create('mail_label_message', function (Blueprint $table) {
            $table->id();
            $table->foreignId('mail_message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mail_label_id')->constrained()->cascadeOnDelete();

            $table->unique(['mail_message_id', 'mail_label_id'], 'mail_label_message_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_label_message');
        Schema::dropIfExists('mail_labels');
    }
};
