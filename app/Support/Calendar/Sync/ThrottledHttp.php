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
    public static function configure(PendingRequest $request, int $attempts = 5): PendingRequest
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
            return min(10_000, max(0, (int) $header) * 1000);
        }

        return min(8_000, (2 ** $attempt) * 400);
    }

    private static function shouldRetry(mixed $exception): bool
    {
        $status = $exception instanceof RequestException
            ? $exception->response?->status()
            : null;

        return $status === 429 || $status === 503;
    }
}
