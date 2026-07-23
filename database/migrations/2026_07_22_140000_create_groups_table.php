<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A named set of staff — a team, department, project or committee.
     *
     * The portal had no organization structure at all: the "Distribution
     * Groups" screen kept its list in a JavaScript array that was lost on
     * reload, and messaging "groups" are conversations, which is a chat
     * construct rather than an org one. This is the real thing, so a calendar
     * can be shared with Marketing once instead of with each marketer, and
     * membership stays correct as people join and leave.
     *
     * Deliberately org-wide rather than calendar-owned: the same group is
     * meant to be reusable by file sharing and messaging later.
     */
    public function up(): void
    {
        Schema::create('groups', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->string('name');
            $table->text('description')->nullable();

            // team | department | project | committee | organization
            $table->string('group_type', 24)->default('team');

            /*
             * Membership follows the staff list rather than being curated —
             * the "General Staff" case. Approved staff are folded in on
             * access, so the group never quietly excludes a new joiner.
             * Mirrors conversations.auto_join.
             */
            $table->boolean('auto_join')->default(false);

            $table->boolean('is_archived')->default(false);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('name');
            $table->index('group_type');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('groups');
    }
};
