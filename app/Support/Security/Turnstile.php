<?php

namespace App\Support\Security;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

/**
 * Cloudflare Turnstile on the public auth posts.
 *
 * Disabled when the secret is empty so local and PHPUnit keep working
 * without a network call. Production sets TURNSTILE_SITE_KEY + SECRET.
 */
final class Turnstile
{
    public static function enabled(): bool
    {
        return (string) config('services.turnstile.secret', '') !== ''
            && (string) config('services.turnstile.site_key', '') !== '';
    }

    public static function siteKey(): ?string
    {
        $key = (string) config('services.turnstile.site_key', '');

        return $key !== '' ? $key : null;
    }

    public static function assert(Request $request): void
    {
        if (! self::enabled()) {
            return;
        }

        $token = (string) $request->input('cf-turnstile-response', '');
        if ($token === '') {
            throw ValidationException::withMessages([
                'email' => 'Please confirm you are human and try again.',
            ]);
        }

        $response = Http::asForm()
            ->timeout(8)
            ->post('https://challenges.cloudflare.com/turnstile/v0/siteverify', [
                'secret' => config('services.turnstile.secret'),
                'response' => $token,
                'remoteip' => $request->ip(),
            ]);

        if (! $response->ok() || ! $response->json('success')) {
            throw ValidationException::withMessages([
                'email' => 'Human verification failed. Refresh the page and try again.',
            ]);
        }
    }
}
