<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Sign-ins only started feeding the Activities panel now, but the auth_events
 * table has been recording them all along. Backfill the last 30 days so the
 * panel opens with real history instead of sitting empty until people log in
 * again. One-shot data migration; new logins are written by RecordAuthEvent.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Don't double up if the listener has already begun writing these.
        $already = DB::table('activity_logs')->where('activity_type', 'security.login')->exists();
        if ($already) {
            return;
        }

        $events = DB::table('auth_events')
            ->join('users', 'users.id', '=', 'auth_events.user_id')
            ->where('auth_events.event', 'login')
            ->where('auth_events.created_at', '>=', now()->subDays(30))
            ->orderByDesc('auth_events.created_at')
            ->limit(500)
            ->get([
                'auth_events.user_id', 'auth_events.ip', 'auth_events.user_agent',
                'auth_events.created_at', 'users.name',
            ]);

        $rows = $events->map(fn ($e) => [
            'uid' => (string) Str::ulid(),
            'actor_id' => $e->user_id,
            'activity_type' => 'security.login',
            'module' => 'security',
            'action' => 'login',
            'description' => $e->name.' signed in',
            'subject_type' => null,
            'subject_id' => null,
            'ip_address' => $e->ip,
            'user_agent' => $e->user_agent ? mb_substr($e->user_agent, 0, 255) : null,
            'status' => 'success',
            'created_at' => $e->created_at,
            'updated_at' => $e->created_at,
        ])->all();

        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table('activity_logs')->insert($chunk);
        }
    }

    public function down(): void
    {
        // Only remove what this migration could have created: backfilled rows
        // have no subject, which the live listener always sets.
        DB::table('activity_logs')
            ->where('activity_type', 'security.login')
            ->whereNull('subject_type')
            ->delete();
    }
};
