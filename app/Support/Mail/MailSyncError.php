<?php

namespace App\Support\Mail;

use Throwable;

/**
 * Turns a sync failure into something a person can act on.
 *
 * The panel used to show nothing (or "Something went wrong"); the real reason
 * lived only in an exception nobody saw. This maps the failure onto a short
 * machine code plus a plain sentence, while the raw detail still goes to the
 * logs for whoever has to dig.
 */
class MailSyncError
{
    /** @return array{code: string, message: string} */
    public static function describe(Throwable $e): array
    {
        if ($e instanceof MailAuthException) {
            // Already written for the user (token expired, scopes missing…).
            return ['code' => 'auth', 'message' => $e->getMessage()];
        }

        $raw = $e->getMessage();

        if (str_contains($raw, 'error 429') || str_contains($raw, 'TooManyRequests')) {
            return [
                'code' => 'rate-limit',
                'message' => 'Microsoft is rate-limiting this mailbox. The import pauses and resumes automatically.',
            ];
        }

        if (preg_match('/error 5\d\d/', $raw) || str_contains($raw, 'MailboxNotEnabled')) {
            return [
                'code' => 'provider',
                'message' => 'The mailbox is temporarily unavailable at the provider. The import will retry shortly.',
            ];
        }

        if (str_contains($raw, 'cURL error') || str_contains($raw, 'Connection timed out') || str_contains($raw, 'timed out')) {
            return [
                'code' => 'network',
                'message' => 'The mail provider could not be reached. The import will retry shortly.',
            ];
        }

        return [
            'code' => 'sync-failed',
            'message' => 'The mailbox import hit an unexpected error. It will retry automatically.',
        ];
    }
}
