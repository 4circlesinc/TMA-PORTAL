<?php

namespace App\Support\SharePoint;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * App-only Microsoft Graph access for the organization's SharePoint libraries.
 *
 * App-only (client credentials), NOT delegated: an organization library must
 * keep syncing when the person who set it up is on holiday or has left, and a
 * delegated token would give each user a different view of the same library.
 *
 * The app holds `Sites.Selected`, which by itself grants access to NOTHING.
 * An administrator authorises this app per site; anything not granted returns
 * 403 no matter what the token says. That is the point of choosing it — the
 * portal cannot reach a library nobody approved.
 */
class GraphClient
{
    private const BASE = 'https://graph.microsoft.com/v1.0';

    private const TOKEN_CACHE_KEY = 'sharepoint.graph.app-token';

    public static function isConfigured(): bool
    {
        return (bool) (config('services.microsoft.client_id')
            && config('services.microsoft.client_secret')
            && config('services.microsoft.graph_tenant_id'));
    }

    /**
     * A cached app-only access token.
     *
     * Cached slightly short of its real lifetime so a request never starts with
     * a token that expires mid-flight.
     */
    public static function token(): ?string
    {
        if (! self::isConfigured()) {
            return null;
        }

        return Cache::remember(self::TOKEN_CACHE_KEY, now()->addMinutes(50), function () {
            $tenant = config('services.microsoft.graph_tenant_id');

            $response = Http::asForm()->connectTimeout(10)->timeout(30)->post(
                "https://login.microsoftonline.com/{$tenant}/oauth2/v2.0/token",
                [
                    'client_id' => config('services.microsoft.client_id'),
                    'client_secret' => config('services.microsoft.client_secret'),
                    // .default asks for whatever application permissions the
                    // admin has consented to — never a scope list of our own.
                    'scope' => 'https://graph.microsoft.com/.default',
                    'grant_type' => 'client_credentials',
                ]
            );

            if (! $response->successful()) {
                throw new GraphException(
                    'Could not obtain an app-only token: '.
                    ($response->json('error_description') ?? $response->body())
                );
            }

            return $response->json('access_token');
        });
    }

    /** @return array<string, mixed> */
    public static function get(string $path, array $query = []): array
    {
        return self::request('GET', $path, $query);
    }

    public static function request(string $method, string $path, array $query = [], array $body = []): array
    {
        $token = self::token();
        if (! $token) {
            throw new GraphException('Microsoft Graph is not configured.');
        }

        $url = str_starts_with($path, 'http') ? $path : self::BASE.$path;

        // Timeouts are not optional here. Without them a stalled Graph
        // response hangs the sync process for ever — observed on a real drive,
        // where one request froze the whole import with no error and no
        // progress. Better to fail an item and retry it than to wedge.
        $request = Http::withToken($token)
            ->connectTimeout(15)
            ->timeout(120)
            ->acceptJson();

        /*
         * Only pass a query array when there IS one.
         *
         * Http::get($url, []) replaces the URL's own query string. Graph's
         * delta nextLink carries its $skiptoken there, so passing an empty
         * array stripped the token and every "next page" request returned
         * page ONE — the walk processed the same 200 items fifty times, never
         * reached the deltaLink, and restarted from scratch on every run. It
         * looked like a hang; it was an infinite loop over the first page.
         */
        $response = $method === 'GET'
            ? ($query === [] ? $request->get($url) : $request->get($url, $query))
            : $request->send($method, $url, ['json' => $body]);

        // 429 and 503 carry Retry-After; the caller decides whether to wait,
        // because a background sync and an interactive request want different
        // answers to "should I block?".
        if ($response->status() === 429 || $response->status() === 503) {
            throw new GraphThrottledException(
                'Graph asked us to slow down.',
                (int) ($response->header('Retry-After') ?: 10)
            );
        }

        if (! $response->successful()) {
            throw new GraphException(
                'Graph '.$method.' '.$path.' failed ('.$response->status().'): '.
                ($response->json('error.message') ?? $response->body()),
                $response->status()
            );
        }

        return $response->json() ?? [];
    }

    /** Forget the cached token — used after a credential change. */
    public static function forgetToken(): void
    {
        Cache::forget(self::TOKEN_CACHE_KEY);
    }
}
