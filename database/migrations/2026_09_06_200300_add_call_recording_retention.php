<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('call_recordings', function (Blueprint $table) {
            $table->boolean('legal_hold')->default(false);
            $table->timestamp('retain_until')->nullable();
        });

        Schema::create('call_recording_access_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('call_recording_id')->constrained('call_recordings')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 24)->default('play');
            $table->string('ip', 45)->nullable();
            $table->timestamp('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('call_recording_access_logs');
        Schema::table('call_recordings', function (Blueprint $table) {
            $table->dropColumn(['legal_hold', 'retain_until']);
        });
    }
};
