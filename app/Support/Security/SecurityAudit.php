<?php

namespace App\Support\Security;

use Illuminate\Support\Facades\Log;

/**
 * Append-only security trail outside the database.
 *
 * activity_logs and auth_events can be edited if the DB is. This channel
 * writes to storage/logs/security.log (and Papertrail/Slack when configured)
 * so a copy exists that the in-app UI cannot delete.
 */
final class SecurityAudit
{
    /**
     * @param  array<string, mixed>  $context
     */
    public static function record(string $event, array $context = []): void
    {
        $payload = array_merge([
            'event' => $event,
            'at' => now()->toIso8601String(),
            'ip' => request()?->ip(),
        ], $context);

        foreach (['password', 'token', 'secret', 'cf-turnstile-response'] as $hide) {
            unset($payload[$hide]);
        }

        try {
            Log::channel('security')->info($event, $payload);
        } catch (\Throwable) {
            // Auditing must never break sign-in or a download.
        }
    }
}
