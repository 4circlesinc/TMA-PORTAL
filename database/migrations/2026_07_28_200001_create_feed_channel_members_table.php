<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One person's membership of one channel, and the role it carries.
     *
     * The role ladder is owner > admin > moderator > member. A channel's
     * *_policy columns say which rung each action needs, so the same row
     * answers "may they post here?" and "may they pin this?" without a
     * separate permission table.
     *
     * `last_read_at` is what the unread dot on the sidebar is derived from,
     * and `email_frequency` is the per-channel override of the account-level
     * notification preference — a person can follow one channel closely and
     * mute another without leaving either.
     */
    public function up(): void
    {
        Schema::create('feed_channel_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('channel_id')->constrained('feed_channels')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // owner | admin | moderator | member
            $table->string('role', 16)->default('member');

            // Silences portal notifications for this channel without leaving it.
            $table->boolean('is_muted')->default(false);
            // all | mentions | none — overrides the account-level preference.
            $table->string('email_frequency', 16)->default('all');

            // Drives the unread dot; null means "never opened".
            $table->timestamp('last_read_at')->nullable();
            $table->timestamp('joined_at')->nullable();
            // Who added them. Null when they joined an open channel themselves.
            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->unique(['channel_id', 'user_id']);
            // "Every channel this person belongs to" — the My Channels list.
            $table->index(['user_id', 'role']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_channel_members');
    }
};
