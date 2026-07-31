<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Fold the old `client_invites` rows into `invitations` and retire the table.
 *
 * Old tokens were stored in plain text, so they are hashed on the way across —
 * any link already in someone's inbox keeps working, and the plaintext is gone.
 * The legacy /client-invite/{token} route still resolves (it redirects to
 * /invite/{token}), so nothing that was sent before this migration breaks.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('client_invites')) {
            return;
        }

        foreach (DB::table('client_invites')->orderBy('id')->cursor() as $old) {
            $hash = hash('sha256', $old->token);

            // A resend used to reuse the row, so a hash collision here would
            // mean the same token twice — skip rather than fail the migration.
            if (DB::table('invitations')->where('token_hash', $hash)->exists()) {
                continue;
            }

            $status = match (true) {
                $old->accepted_at !== null => 'accepted',
                $old->expires_at !== null && strtotime($old->expires_at) < time() => 'expired',
                $old->last_sent_at !== null => 'sent',
                default => 'pending',
            };

            DB::table('invitations')->insert([
                'uuid' => (string) Str::uuid(),
                'type' => 'client',
                'token_hash' => $hash,
                'email' => $old->email,
                'name' => DB::table('clients')->where('id', $old->client_id)->value('name'),
                'client_id' => $old->client_id,
                'company_id' => null,
                'role' => 'Client',
                'access' => null,
                'status' => $status,
                'invited_by' => $old->created_by,
                'accepted_user_id' => $old->accepted_at !== null
                    ? DB::table('clients')->where('id', $old->client_id)->value('user_id')
                    : null,
                'expires_at' => $old->expires_at,
                'last_sent_at' => $old->last_sent_at,
                'accepted_at' => $old->accepted_at,
                'send_count' => $old->last_sent_at !== null ? 1 : 0,
                'created_at' => $old->created_at,
                'updated_at' => $old->updated_at,
            ]);
        }

        Schema::dropIfExists('client_invites');
    }

    public function down(): void
    {
        // The old table is recreated by its original migration; the rows that
        // came from it are left in `invitations` rather than copied back, since
        // their plaintext tokens no longer exist to restore.
    }
};
