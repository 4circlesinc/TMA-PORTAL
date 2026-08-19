<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Availability status on top of the existing online heartbeat.
     *
     * Online/offline stays derived from `online_until`. The new columns hold
     * the user's chosen or detected availability (on a call, in office, …)
     * plus optional message and expiry. Active layered states live in
     * user_presence_states; this row carries the resolved primary display.
     */
    public function up(): void
    {
        Schema::table('user_presence', function (Blueprint $table) {
            $table->string('primary_status', 32)->nullable()->after('online_until');
            $table->string('status_source', 16)->nullable()->after('primary_status');
            $table->string('status_message', 140)->nullable()->after('status_source');
            $table->timestamp('status_started_at')->nullable()->after('status_message');
            $table->timestamp('status_expires_at')->nullable()->after('status_started_at');

            $table->index('primary_status');
            $table->index('status_expires_at');
        });

        Schema::create('user_presence_states', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 32);
            $table->string('source', 16);
            $table->string('status_message', 140)->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'status']);
            $table->index(['user_id', 'expires_at']);
        });

        Schema::create('user_status_schedules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('status', 32);
            $table->string('status_message', 140)->nullable();
            $table->timestamp('starts_at');
            $table->timestamp('ends_at');
            $table->string('recurrence', 32)->nullable();
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->index(['user_id', 'starts_at', 'ends_at']);
        });

        Schema::create('user_locations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type', 16);
            $table->string('label', 120)->nullable();
            $table->string('address', 255)->nullable();
            $table->decimal('latitude', 10, 7);
            $table->decimal('longitude', 10, 7);
            $table->unsignedInteger('radius_m')->default(100);
            $table->boolean('enabled')->default(true);
            $table->timestamps();

            $table->unique(['user_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_locations');
        Schema::dropIfExists('user_status_schedules');
        Schema::dropIfExists('user_presence_states');
        Schema::table('user_presence', function (Blueprint $table) {
            $table->dropIndex(['primary_status']);
            $table->dropIndex(['status_expires_at']);
            $table->dropColumn([
                'primary_status',
                'status_source',
                'status_message',
                'status_started_at',
                'status_expires_at',
            ]);
        });
    }
};
