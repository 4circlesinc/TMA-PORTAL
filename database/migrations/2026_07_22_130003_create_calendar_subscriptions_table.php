<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One user's personal view of one calendar: whether it sits in their
     * sidebar, whether its events are currently drawn, and what colour they
     * see it in.
     *
     * This is deliberately separate from calendar_members. Permission is
     * "may I see this?"; a subscription is "do I want it in my list?" — which
     * is why removing a colleague's calendar from your sidebar must not touch
     * their calendar or your access to it. Hiding a calendar likewise only
     * flips `is_visible`; nothing is deleted and no permission changes.
     */
    public function up(): void
    {
        Schema::create('calendar_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('calendar_id')->constrained('calendars')->cascadeOnDelete();

            // The sidebar checkbox. Purely a display concern.
            $table->boolean('is_visible')->default(true);

            /*
             * A personal colour override. Left null for organization and group
             * calendars, where the manager's official colour is what everyone
             * sees; only calendars the user owns are recoloured per-user.
             */
            $table->string('colour_override', 24)->nullable();

            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'calendar_id']);
            $table->index(['user_id', 'is_visible']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_subscriptions');
    }
};
