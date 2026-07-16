<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('signature_recipients', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('signature_request_id')->constrained('signature_requests')->cascadeOnDelete();

            $table->string('name');
            $table->string('email');
            $table->string('role', 16)->default('signer'); // signer | approver | cc
            $table->unsignedSmallInteger('signing_order')->default(1);
            // pending|viewed|signed|declined
            $table->string('status', 16)->default('pending');

            // Signing links are bearer credentials. Only the SHA-256 hash is
            // stored, so a database leak can't be replayed as a live link; the
            // raw token exists in the emailed URL and nowhere else. Unique so
            // lookup stays a single indexed hash match.
            $table->string('token_hash', 64)->nullable()->unique();
            $table->timestamp('token_expires_at')->nullable();

            $table->timestamp('viewed_at')->nullable();
            $table->timestamp('signed_at')->nullable();
            $table->timestamp('declined_at')->nullable();
            $table->string('decline_reason')->nullable();
            $table->string('last_ip', 45)->nullable();
            $table->timestamps();

            $table->index('signature_request_id');
            $table->index('email');
            $table->index(['signature_request_id', 'signing_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('signature_recipients');
    }
};
