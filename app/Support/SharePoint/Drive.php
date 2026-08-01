<?php

namespace App\Support\SharePoint;

use Illuminate\Support\Facades\Http;

/**
 * The document-library operations sync needs, expressed in Graph's terms.
 *
 * Deliberately thin: it translates Graph's shapes into arrays and does nothing
 * about the portal's own model. Everything that decides *what to do* with an
 * item lives in Synchroniser and Pusher, so this file stays testable by
 * pointing it at a fake HTTP client.
 */
class Drive
{
    /** Page size for delta. Graph caps this; asking for more is not an error. */
    private const PAGE = 200;

    /** @return array<int, array<string, mixed>> */
    public static function libraries(string $siteId): array
    {
        return GraphClient::get("/sites/{$siteId}/drives")['value'] ?? [];
    }

    /**
     * One page of changes.
     *
     * `$link` is either null (start from the beginning), or the
     * `@odata.nextLink` / `@odata.deltaLink` handed back last time. Both are
     * absolute URLs and must be followed verbatim — rebuilding them from parts
     * loses the token and silently restarts the whole library.
     *
     * @return array{items: array<int, array>, next: ?string, delta: ?string}
     */
    public static function delta(string $driveId, ?string $link = null, ?string $rootItemId = null): array
    {
        // Delta works against any folder, which is what lets a connection sync
        // one folder of a personal OneDrive instead of the whole drive.
        $start = $rootItemId
            ? "/drives/{$driveId}/items/{$rootItemId}/delta"
            : "/drives/{$driveId}/root/delta";

        $response = $link
            ? GraphClient::get($link)
            : GraphClient::get($start, ['$top' => self::PAGE]);

        return [
            'items' => $response['value'] ?? [],
            'next' => $response['@odata.nextLink'] ?? null,
            'delta' => $response['@odata.deltaLink'] ?? null,
        ];
    }

    public static function item(string $driveId, string $itemId): array
    {
        return GraphClient::get("/drives/{$driveId}/items/{$itemId}");
    }

    /**
     * Stream an item's bytes to a local path.
     *
     * Streams rather than buffering: a 2 GB document must not be held in
     * memory, and this runs inside a queue worker where that would take the
     * whole process down.
     */
    public static function download(string $driveId, string $itemId, string $destination): bool
    {
        $token = GraphClient::token();
        if (! $token) {
            throw new GraphException('Microsoft Graph is not configured.');
        }

        // A download can legitimately take a while, but never forever.
        $response = Http::withToken($token)
            ->connectTimeout(15)
            ->timeout(600)
            ->withOptions(['stream' => true])
            ->get("https://graph.microsoft.com/v1.0/drives/{$driveId}/items/{$itemId}/content");

        if (! $response->successful()) {
            throw new GraphException(
                'Could not download item '.$itemId.' ('.$response->status().')',
                $response->status()
            );
        }

        $out = fopen($destination, 'wb');
        if ($out === false) {
            throw new GraphException('Could not open a local file to download into.');
        }

        try {
            $body = $response->toPsrResponse()->getBody();
            $idle = 0;

            while (! $body->eof()) {
                $chunk = $body->read(1024 * 512);

                // eof() can stay false while read() returns nothing on a
                // stalled connection, which spins this loop for ever. Give up
                // after a run of empty reads rather than hang the sync.
                if ($chunk === '') {
                    if (++$idle > 50) {
                        throw new GraphException('Download stalled for item '.$itemId);
                    }

                    usleep(100_000);

                    continue;
                }

                $idle = 0;
                fwrite($out, $chunk);
            }
        } finally {
            fclose($out);
        }

        return true;
    }

    /**
     * Create or replace an item's content.
     *
     * Small files go in one PUT; anything larger uses an upload session in
     * chunks, because Graph refuses a simple upload over 4 MB (and a 2 GB PUT
     * would fail on timeouts long before that limit mattered).
     */
    public static function upload(string $driveId, string $parentItemId, string $name, string $sourcePath): array
    {
        $size = filesize($sourcePath) ?: 0;

        return $size <= 4 * 1024 * 1024
            ? self::simpleUpload($driveId, $parentItemId, $name, $sourcePath)
            : self::sessionUpload($driveId, $parentItemId, $name, $sourcePath, $size);
    }

    private static function simpleUpload(string $driveId, string $parentItemId, string $name, string $sourcePath): array
    {
        $token = GraphClient::token();
        $path = "/drives/{$driveId}/items/{$parentItemId}:/".rawurlencode($name).':/content';

        $response = Http::withToken($token)
            ->connectTimeout(15)
            ->timeout(300)
            ->withBody(file_get_contents($sourcePath), 'application/octet-stream')
            ->put('https://graph.microsoft.com/v1.0'.$path);

        if (! $response->successful()) {
            throw new GraphException('Upload failed ('.$response->status().'): '.$response->body(), $response->status());
        }

        return $response->json();
    }

    private static function sessionUpload(string $driveId, string $parentItemId, string $name, string $sourcePath, int $size): array
    {
        $token = GraphClient::token();

        $session = GraphClient::request(
            'POST',
            "/drives/{$driveId}/items/{$parentItemId}:/".rawurlencode($name).':/createUploadSession',
            [],
            // `replace` keeps SharePoint's own version history: uploading over
            // an existing item is a new version there, not a second file.
            ['item' => ['@microsoft.graph.conflictBehavior' => 'replace']]
        );

        $url = $session['uploadUrl'] ?? null;
        if (! $url) {
            throw new GraphException('Graph did not return an upload URL.');
        }

        $chunk = 5 * 1024 * 1024;   // must be a multiple of 320 KiB
        $handle = fopen($sourcePath, 'rb');
        if ($handle === false) {
            throw new GraphException('Could not read the file to upload.');
        }

        try {
            $offset = 0;
            $result = [];

            while ($offset < $size) {
                $bytes = fread($handle, $chunk);
                $length = strlen($bytes);
                $end = $offset + $length - 1;

                // The upload URL is pre-authorised; sending the bearer token
                // as well makes Graph reject the chunk.
                $response = Http::withHeaders([
                    'Content-Length' => (string) $length,
                    'Content-Range' => "bytes {$offset}-{$end}/{$size}",
                ])->connectTimeout(15)->timeout(300)
                    ->withBody($bytes, 'application/octet-stream')->put($url);

                if (! in_array($response->status(), [200, 201, 202], true)) {
                    throw new GraphException(
                        'Chunk upload failed at '.$offset.' ('.$response->status().'): '.$response->body(),
                        $response->status()
                    );
                }

                if (in_array($response->status(), [200, 201], true)) {
                    $result = $response->json();
                }

                $offset += $length;
            }

            return $result;
        } finally {
            fclose($handle);
            unset($token);
        }
    }

    public static function createFolder(string $driveId, string $parentItemId, string $name): array
    {
        return GraphClient::request('POST', "/drives/{$driveId}/items/{$parentItemId}/children", [], [
            'name' => $name,
            'folder' => new \stdClass,
            // Never silently merge into an existing folder of the same name.
            '@microsoft.graph.conflictBehavior' => 'rename',
        ]);
    }

    public static function rename(string $driveId, string $itemId, string $name): array
    {
        return GraphClient::request('PATCH', "/drives/{$driveId}/items/{$itemId}", [], ['name' => $name]);
    }

    public static function move(string $driveId, string $itemId, string $newParentId): array
    {
        return GraphClient::request('PATCH', "/drives/{$driveId}/items/{$itemId}", [], [
            'parentReference' => ['id' => $newParentId],
        ]);
    }

    /** Graph's DELETE sends the item to SharePoint's recycle bin, not oblivion. */
    public static function delete(string $driveId, string $itemId): void
    {
        GraphClient::request('DELETE', "/drives/{$driveId}/items/{$itemId}");
    }

    public static function root(string $driveId): array
    {
        return GraphClient::get("/drives/{$driveId}/root");
    }
}
