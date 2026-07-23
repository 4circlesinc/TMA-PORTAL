<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Who belongs to a group.
     *
     * `role` is about running the group, not about anything the group is
     * granted elsewhere: a manager may add and remove members, a member just
     * belongs. What the group can *see* is decided per calendar, by the
     * calendar_members row that grants to it.
     */
    public function up(): void
    {
        Schema::create('group_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('group_id')->constrained('groups')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // member | manager
            $table->string('role', 16)->default('member');

            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['group_id', 'user_id']);
            // "which groups is this person in?" runs on every access check.
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('group_members');
    }
};
