<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-recipient portal notifications — the bell popup, the right-sidebar
     * Notifications section, and the unread badge all read from here.
     *
     * Named `portal_notifications` on purpose: Laravel's Notifiable trait owns
     * the reserved `notifications` table (uuid pk, `data` blob), and we want a
     * first-class, queryable, filterable schema instead of an opaque JSON blob.
     *
     * `actor_id` is the person who caused it (rendered as their avatar); a null
     * actor means the system generated it (rendered as a circular `icon`).
     * `dedupe_key` collapses repeat events (e.g. three files shared in a row)
     * into one refreshed row rather than three.
     */
    public function up(): void
    {
        Schema::create('portal_notifications', function (Blueprint $table) {
            $table->id();
            $table->ulid('uid')->unique();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();      // recipient
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('type', 64);            // e.g. 'message.received', 'account.pending'
            $table->string('level', 24)->default('info'); // info | success | warning | error | action_required | approval_required | security | reminder
            $table->string('module', 32);
            $table->string('title');
            $table->text('message')->nullable();
            $table->string('icon', 64)->nullable();  // phosphor icon name for system notifications
            $table->string('image')->nullable();     // explicit avatar/logo url when not actor-derived
            $table->nullableMorphs('subject');       // the related record
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->string('action_url')->nullable();
            $table->string('action_label', 64)->nullable();
            $table->string('priority', 16)->default('normal'); // low | normal | high | urgent
            $table->string('dedupe_key')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('completed_at')->nullable(); // action-required items: when the action was fulfilled
            $table->jsonb('metadata')->nullable();
            $table->timestamps();

            $table->index('actor_id');
            $table->index('type');
            $table->index('module');
            $table->index('priority');
            $table->index('created_at');
            // Hot paths: the unread badge and the unread filter.
            $table->index(['user_id', 'read_at']);
            // Dedupe lookups scope to the recipient.
            $table->index(['user_id', 'dedupe_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('portal_notifications');
    }
};
