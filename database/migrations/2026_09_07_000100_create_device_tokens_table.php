<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Push tokens for the native apps (docs/android-app-prompt.md §13). One row
 * per installed app; a token is unique across users because FCM hands it to
 * the device, not the account. session_id remembers which sign-in registered
 * it, so signing out on that device drops its token and nothing else.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('platform', 16)->default('android');
            $table->string('token', 512)->unique();
            $table->string('app_version', 32)->nullable();
            $table->string('device_name', 120)->nullable();
            $table->string('session_id', 100)->nullable()->index();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('device_tokens');
    }
};
