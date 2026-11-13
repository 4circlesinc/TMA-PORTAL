<?php

namespace App\Support\Calendar\Sync;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Client\Response;

/**
 * Google and Graph both 429 when several calendars (and mail) hit the same
 * mailbox at once. Graph's wording is "Application is over its
 * MailboxConcurrency limit" — four concurrent requests per mailbox. Retry
 * in-request, honour Retry-After, and let the job reschedule rather than
 * recording a user-facing failure.
 */
final class ThrottledHttp
{
    public static function configure(PendingRequest $request, int $attempts = 2): PendingRequest
    {
        return $request->retry(
            $attempts,
            fn (int $attempt, mixed $exception) => self::delayMilliseconds($attempt, $exception),
            fn (mixed $exception) => self::shouldRetry($exception),
            throw: false,
        );
    }

    public static function isThrottled(Response $response): bool
    {
        return in_array($response->status(), [429, 503], true);
    }

    /**
     * The provider's gateway gave up rather than refused: Exchange timing out
     * while it expands a wide calendar view, a backend restarting. Not
     * retried in configure(): there it would also replay creates, and a 502
     * on a create may still have made the event. Reads retry it themselves.
     */
    public static function isUnavailable(Response $response): bool
    {
        return in_array($response->status(), [500, 502, 504], true);
    }

    public static function retryAfter(Response $response, int $default = 20): int
    {
        $header = $response->header('Retry-After');

        return min(120, max(15, (int) ($header !== null && $header !== '' ? $header : $default)));
    }

    private static function delayMilliseconds(int $attempt, mixed $exception): int
    {
        $header = $exception instanceof RequestException
            ? $exception->response?->header('Retry-After')
            : null;

        if ($header !== null && $header !== '') {
            if (! is_numeric($header)) {
                $until = strtotime($header);

                return $until ? min(10_000, max(0, ($until - time()) * 1000)) : 5_000;
            }

            return min(10_000, max(0, (int) $header) * 1000);
        }

        // MailboxConcurrency 429s often omit Retry-After. Retrying in
        // hundreds of milliseconds is what kept the mailbox hot.
        return min(8_000, max(5_000, (2 ** $attempt) * 400));
    }

    private static function shouldRetry(mixed $exception): bool
    {
        $status = $exception instanceof RequestException
            ? $exception->response?->status()
            : null;

        return $status === 429 || $status === 503;
    }
}
