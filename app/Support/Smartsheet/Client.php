<?php

namespace App\Support\Smartsheet;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Thin wrapper over the Smartsheet REST API (v2.0).
 *
 * Auth is a single service token from config — server-side only, never
 * per-user, never sent to the browser. There is deliberately no retry loop
 * here: 429/503 become SmartsheetThrottledException carrying Retry-After and
 * the queue-job layer decides (the SharePoint stack's division of labour).
 */
class Client
{
    private const BASE = 'https://api.smartsheet.com/2.0';

    public static function configured(): bool
    {
        return (string) config('services.smartsheet.token') !== ''
            && (string) config('services.smartsheet.workspace_id') !== '';
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    public static function get(string $path, array $query = []): array
    {
        $request = Http::withToken((string) config('services.smartsheet.token'))
            ->acceptJson()
            // Timeouts are mandatory — a single stalled response once wedged
            // an entire SharePoint import for the worker's whole lifetime.
            // 300s because Smartsheet serves dense 210-column grids at a
            // trickle (~8 KB/s observed); a 200-row page needs the headroom.
            ->connectTimeout(15)
            ->timeout(300);

        /*
         * Query only when non-empty: Laravel's Http::get($url, []) REPLACES
         * the URL's own query string with the (empty) array, which is the
         * exact bug that made the SharePoint sync re-read page one forever.
         */
        $response = $query === []
            ? $request->get(self::BASE.$path)
            : $request->get(self::BASE.$path, $query);

        return self::unwrap($response, $path);
    }

    /**
     * Pages through an index endpoint (attachments, discussions) and returns
     * every row of `data`. Smartsheet's includeAll=true does this server-side
     * for most listings; page/pageSize is the fallback when it doesn't.
     *
     * @param  array<string, mixed>  $query
     * @return list<array<string, mixed>>
     */
    public static function getAll(string $path, array $query = []): array
    {
        $data = [];
        $page = 1;
        do {
            $payload = self::get($path, $query + ['includeAll' => 'true', 'pageSize' => 500, 'page' => $page]);
            $data = array_merge($data, $payload['data'] ?? []);
            $totalPages = (int) ($payload['totalPages'] ?? 1);
            $page++;
        } while ($page <= $totalPages);

        return $data;
    }

    /**
     * A fresh, short-lived download URL for an attachment. Smartsheet mints
     * an expiring S3 link per request, so this is called at download time,
     * never stored.
     */
    public static function attachmentUrl(int|string $sheetRemoteId, int|string $attachmentRemoteId): ?string
    {
        $payload = self::get('/sheets/'.$sheetRemoteId.'/attachments/'.$attachmentRemoteId);

        return $payload['url'] ?? null;
    }

    /** @return array<string, mixed> */
    private static function unwrap(Response $response, string $path): array
    {
        if ($response->status() === 429 || $response->status() === 503) {
            $retryAfter = (int) ($response->header('Retry-After') ?: 30);
            throw new SmartsheetThrottledException(
                'Smartsheet throttled '.$path, max(1, $retryAfter)
            );
        }

        if ($response->failed()) {
            $detail = (string) ($response->json('message') ?? $response->reason());
            throw new SmartsheetException(
                'Smartsheet request failed ('.$response->status().') for '.$path.': '.$detail,
                $response->status(),
            );
        }

        return $response->json() ?? [];
    }
}
