<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Lets a calendar be granted to a whole group, which is what
     * calendar_members.member_type = 'group' was reserved for.
     *
     * A row is either a user grant (user_id set, group_id null) or a group
     * grant (the reverse). The existing unique on (calendar_id, member_type,
     * user_id) keeps covering user grants — group rows leave user_id null, and
     * nulls compare as distinct, so they never collide with it. The new unique
     * does the same job for group grants.
     */
    public function up(): void
    {
        Schema::table('calendar_members', function (Blueprint $table) {
            $table->foreignId('group_id')->nullable()->after('user_id')
                ->constrained('groups')->cascadeOnDelete();

            $table->unique(['calendar_id', 'member_type', 'group_id']);
            $table->index('group_id');
        });
    }

    public function down(): void
    {
        Schema::table('calendar_members', function (Blueprint $table) {
            $table->dropUnique(['calendar_id', 'member_type', 'group_id']);
            $table->dropConstrainedForeignId('group_id');
        });
    }
};
