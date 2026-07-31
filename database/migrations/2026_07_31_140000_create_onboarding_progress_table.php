<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How far someone has got through guided onboarding, and what they answered.
 *
 * One row per user. `answers` accumulates step by step so somebody can close
 * the tab on step 6 and come back to step 6 — the spec's "must be able to leave
 * and return without losing completed steps". Nothing is written to the user or
 * their client record until a step is submitted, and the whole set is applied
 * again on completion, so a half-finished flow never leaves a half-edited
 * profile behind.
 *
 * `completed_steps` is kept separately from `current_step` because the flow is
 * not strictly linear: steps can be revisited from the review screen, and a
 * step that stops being applicable (company details, when someone switches
 * back to Individual) has to drop out of the count without losing its answer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('onboarding_progress', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            // client | staff — staff onboarding is a later phase, but the
            // column exists now so the two never need separate tables.
            $table->string('flow', 16)->default('client');

            $table->string('current_step', 32)->nullable();
            $table->jsonb('completed_steps')->nullable();
            $table->jsonb('answers')->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['flow', 'completed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('onboarding_progress');
    }
};
