<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * §24 — the application messaging centre.
 *
 * A thread on the file, not a chat conversation. Chat is a free-standing
 * container (participants, DMs, calls); this is a record that belongs to the
 * application the way document comments belong to a checklist slot. Two
 * lanes on the row: internal notes never leave staff, and provider messages
 * are what replace the email side-channel.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_application_messages', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('company_member_id')->nullable()->constrained('company_members')->nullOnDelete();
            $table->string('author_name', 191);
            $table->string('lane', 16);
            $table->text('body');
            $table->timestamps();

            $table->index(['application_id', 'id']);
            $table->index(['application_id', 'lane']);
        });

        Schema::create('cip_application_message_reads', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->unsignedBigInteger('last_read_id')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'application_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_application_message_reads');
        Schema::dropIfExists('cip_application_messages');
    }
};
