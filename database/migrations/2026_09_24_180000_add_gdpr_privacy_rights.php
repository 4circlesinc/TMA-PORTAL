<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * GDPR rights the product can actually carry out: a record of policy
 * acceptance, a flag that stops optional processing, and a log of access,
 * restriction, and erasure requests.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('privacy_policy_accepted_at')->nullable()->after('onboarding_completed_at');
            $table->string('privacy_policy_version', 20)->nullable()->after('privacy_policy_accepted_at');
            $table->timestamp('processing_restricted_at')->nullable()->after('privacy_policy_version');
        });

        Schema::create('privacy_requests', function (Blueprint $table) {
            $table->id();
            // Null if the account row is later removed from the recycle bin.
            // The detail column keeps the snapshot the request needs.
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 32);
            $table->string('status', 20);
            $table->json('detail')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('privacy_requests');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'privacy_policy_accepted_at',
                'privacy_policy_version',
                'processing_restricted_at',
            ]);
        });
    }
};
