<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Microsoft Graph change-notification subscriptions.
 *
 * Polling is a minute at best; these are what make mailbox and OneDrive
 * updates land as they happen. One row per resource we asked Graph to watch.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('graph_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('kind', 20);
            $table->foreignId('connected_account_id')->nullable()
                ->constrained('connected_accounts')->cascadeOnDelete();
            $table->unsignedBigInteger('sharepoint_connection_id')->nullable();
            $table->string('graph_subscription_id', 128);
            $table->string('resource', 512);
            $table->string('client_state', 128);
            $table->timestampTz('expires_at');
            $table->timestampTz('last_notified_at')->nullable();
            $table->text('last_error')->nullable();
            $table->timestamps();

            $table->unique('graph_subscription_id');
            $table->index(['kind', 'expires_at']);
            $table->index('sharepoint_connection_id');

            $table->foreign('sharepoint_connection_id')
                ->references('id')->on('sharepoint_connections')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('graph_subscriptions');
    }
};
