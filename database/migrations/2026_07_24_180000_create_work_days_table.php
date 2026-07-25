<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-user daily work plan / work status (office, remote, leave, hours).
 * Distinct from messaging "Updates" (UserWorkStatus) — this is schedule.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('work_date');
            $table->string('status', 40)->default('in_office');
            $table->time('starts_at')->nullable();
            $table->time('ends_at')->nullable();
            $table->string('location', 255)->nullable();
            $table->string('note', 500)->nullable();
            $table->string('visibility', 20)->default('colleagues'); // private|colleagues
            $table->timestamps();

            $table->unique(['user_id', 'work_date']);
            $table->index(['work_date', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('work_days');
    }
};
