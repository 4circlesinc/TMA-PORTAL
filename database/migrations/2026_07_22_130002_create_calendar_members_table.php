<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An explicit permission grant on a calendar.
     *
     * This is the authority on who may do what: `calendars.visibility` only
     * sets the broad default, and a row here always wins over it. Roles form
     * a ladder (availability → titles → details → contributor → editor →
     * manager → owner); see App\Support\Calendar\CalendarAccess.
     *
     * A grant targets a single user today. `member_type` exists so the group
     * and department phase can grant to a whole group without reshaping the
     * table or rewriting the access checks.
     */
    public function up(): void
    {
        Schema::create('calendar_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('calendar_id')->constrained('calendars')->cascadeOnDelete();

            // 'user' today; 'group' once group calendars land.
            $table->string('member_type', 16)->default('user');
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();

            $table->string('role', 16)->default('details');

            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One grant per person per calendar; re-sharing updates the role
            // rather than stacking a second, ambiguous row.
            $table->unique(['calendar_id', 'member_type', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_members');
    }
};
