<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Signing links must stay retrievable ("copy the signing link") without
     * keeping a replayable secret in the database.
     *
     * `token_hash` stays the lookup key. This holds the same token encrypted
     * with the app key, which lives outside the database - so a dump on its
     * own yields no usable link, but the portal can still show the URL again.
     */
    public function up(): void
    {
        Schema::table('signature_recipients', function (Blueprint $table) {
            $table->text('token_ciphertext')->nullable()->after('token_hash');
            // When this person was actually emailed. Sequential signing invites
            // each group as its turn arrives, so this is what stops the flow
            // re-inviting someone every time it advances.
            $table->timestamp('invited_at')->nullable()->after('token_expires_at');
            $table->timestamp('reminded_at')->nullable()->after('invited_at');
        });
    }

    public function down(): void
    {
        Schema::table('signature_recipients', function (Blueprint $table) {
            $table->dropColumn(['token_ciphertext', 'invited_at', 'reminded_at']);
        });
    }
};
