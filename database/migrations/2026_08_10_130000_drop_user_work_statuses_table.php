<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Updates tab (colleague work statuses) was removed from Messages in
 * August 2026, and this table was its only consumer. The statuses were
 * ephemeral by design — one row per user, no history — so nothing worth
 * keeping is lost by dropping it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('user_work_statuses');
    }

    public function down(): void
    {
        Schema::create('user_work_statuses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('emoji', 16)->nullable();
            $table->string('text', 140);
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->index('updated_at');
        });
    }
};
