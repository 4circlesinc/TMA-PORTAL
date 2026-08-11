<?php

namespace App\Support\Cbi;

use App\Models\CbiApplication;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\SmartsheetAttachment;
use App\Models\SmartsheetSheet;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Vault;
use App\Support\Smartsheet\Client as Smartsheet;
use App\Support\Smartsheet\SmartsheetThrottledException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * Mirrors a citizenship file's paperwork into the client's File Library folder.
 *
 * Until now the caseload knew a document existed — name, size, who attached it
 * — but the bytes stayed in Smartsheet behind a link that expires in minutes.
 * A client record with no papers is half a record, so this brings them across
 * and files them under the person they belong to.
 *
 * Three things shape the design:
 *
 * **It is resumable.** `smartsheet_attachments.file_id` is the record of what
 * has landed, so a run that stops — throttled, interrupted, out of time —
 * simply picks up where it left off. There is a lot to move (tens of thousands
 * of files, hundreds of gigabytes), so stopping and resuming is the normal
 * case, not the exception.
 *
 * **It is polite to Smartsheet.** Every file costs two API calls, one to mint
 * a fresh download URL and one to fetch it. A 429 is not an error here, it is
 * the API asking for a pause, so the run waits the interval it is given and
 * carries on rather than dying with thousands of files still to go.
 *
 * **It never guesses which client.** A document is only filed where the chain
 * from attachment to sheet row to application to client is complete. An
 * orphan is skipped and counted, because the wrong client's folder is a worse
 * place for a passport scan than no folder at all.
 */
class DocumentImporter
{
    /*
     * How many documents are in flight at once.
     *
     * A minted Smartsheet URL is good for about two minutes. Minting sixty-four
     * up front and then downloading them one at a time spent that budget long
     * before the tail of the batch was reached, and every later file came back
     * 403. The batch is minted and downloaded inside the same short window
     * now, so the whole batch is one download's wait rather than the sum.
     */
    private const BATCH = 16;

    /** @var array<string, int> */
    public array $stats = [
        'imported' => 0,
        'skipped' => 0,
        'orphaned' => 0,
        'links' => 0,
        'failed' => 0,
        'foldersCreated' => 0,
        'bytes' => 0,
    ];

    /** @var array<int, string> */
    public array $errors = [];

    /** @var array<int, int> application id => folder id */
    private array $folders = [];

    public function __construct(
        private User $actor,
        private bool $dryRun = false,
    ) {}

    /** Survey counts change slowly; keep them warm across CBI summary polls
     *  and the global sync-toast endpoint that asks the same question. */
    private const SURVEY_TTL_SECONDS = 15;

    private const SURVEY_CACHE_KEY = 'cbi.document-survey';

    /**
     * How much there is to do, without doing any of it.
     *
     * @return array{files: int, sizeKb: int, done: int, orphaned: int, clients: int}
     */
    public function survey(): array
    {
        return Cache::remember(self::SURVEY_CACHE_KEY, self::SURVEY_TTL_SECONDS, fn () => $this->surveyFresh());
    }

    /** Drop the warm survey so the next poll reflects a just-finished batch. */
    public static function flushSurvey(): void
    {
        Cache::forget(self::SURVEY_CACHE_KEY);
    }

    /**
     * @return array{files: int, sizeKb: int, done: int, orphaned: int, clients: int}
     */
    private function surveyFresh(): array
    {
        $pending = SmartsheetAttachment::query()
            ->whereNull('file_id')
            ->where('attachment_type', 'FILE');

        $reachable = $this->reachableQuery()->whereNull('smartsheet_attachments.file_id');

        $pendingFiles = (clone $pending)->count();
        $reachableFiles = (clone $reachable)->count();

        return [
            'files' => $pendingFiles,
            'sizeKb' => (int) (clone $pending)->sum('size_kb'),
            'done' => SmartsheetAttachment::whereNotNull('file_id')->count(),
            'orphaned' => max(0, $pendingFiles - $reachableFiles),
            'clients' => (clone $reachable)->distinct('cbi_applications.client_id')->count('cbi_applications.client_id'),
        ];
    }

    /**
     * Attachments that can actually be filed: the join from the attachment
     * through its sheet and row to an application that has a client.
     *
     * Row attachments hang off a tracker row that feeds an application;
     * sheet-level ones hang off an assessment sheet already pointed at one.
     */
    private function reachableQuery()
    {
        return SmartsheetAttachment::query()
            ->select('smartsheet_attachments.*', 'cbi_applications.client_id', 'cbi_applications.id as application_id')
            ->join('smartsheet_sheets', 'smartsheet_sheets.id', '=', 'smartsheet_attachments.sheet_id')
            ->leftJoin('cbi_application_sources', function ($join) {
                $join->on('cbi_application_sources.sheet_remote_id', '=', 'smartsheet_sheets.remote_id')
                    ->on('cbi_application_sources.row_remote_id', '=', 'smartsheet_attachments.parent_remote_id');
            })
            ->join('cbi_applications', function ($join) {
                $join->on('cbi_applications.id', '=', 'cbi_application_sources.application_id')
                    ->orOn('cbi_applications.id', '=', 'smartsheet_sheets.cbi_application_id');
            })
            ->whereNotNull('cbi_applications.client_id')
            ->where('smartsheet_attachments.attachment_type', 'FILE');
    }

    /**
     * Bring across up to $limit documents.
     *
     * @param  callable|null  $progress  called with the attachment just handled
     */
    public function import(?int $limit = null, ?callable $progress = null): void
    {
        $query = $this->reachableQuery()
            ->whereNull('smartsheet_attachments.file_id')
            ->orderBy('smartsheet_attachments.id');

        if ($limit) {
            $query->limit($limit);
        }

        /*
         * URLs first, in concurrent batches, then the bytes.
         *
         * Minting a download URL costs a round trip to Smartsheet of about two
         * and a half seconds, and there is no bulk endpoint — done one after
         * another that is thirteen hours of waiting before a single byte
         * moves. Fetched eight at a time it is closer to ninety minutes.
         */
        foreach ($query->get()->chunk(self::BATCH) as $batch) {
            $this->importBatch($batch, $progress);
        }
    }

    /**
     * Mint this batch's URLs together, fetch the bytes together, then file
     * them. Both halves are concurrent because both are round trips to
     * somebody else's server, and the second must start while the first
     * half's URLs are still alive.
     *
     * @param  \Illuminate\Support\Collection<int, SmartsheetAttachment>  $batch
     */
    private function importBatch($batch, ?callable $progress): void
    {
        if ($this->dryRun) {
            foreach ($batch as $row) {
                $this->importOne($row, null);
                if ($progress) {
                    $progress($row);
                }
            }

            return;
        }

        $sheets = SmartsheetSheet::whereIn('id', $batch->pluck('sheet_id')->unique())->get()->keyBy('id');

        $pairs = [];
        foreach ($batch as $row) {
            $sheet = $sheets[$row->sheet_id] ?? null;
            if ($sheet) {
                $pairs[$row->id] = [$sheet->remote_id, $row->remote_id];
            }
        }

        $urls = $pairs === [] ? [] : Smartsheet::attachmentUrls($pairs, self::BATCH);
        $files = $urls === [] ? [] : $this->downloadMany($urls);

        foreach ($batch as $row) {
            $this->importOne($row, $urls[$row->id] ?? null, $files[$row->id] ?? null);
            if ($progress) {
                $progress($row);
            }
        }
    }

    /**
     * Fetch many pre-signed URLs at once, each straight to its own temp file.
     *
     * @param  array<int, string>  $urls  attachment id => URL
     * @return array<int, string>  attachment id => temp path
     */
    private function downloadMany(array $urls): array
    {
        $paths = [];
        foreach ($urls as $key => $_) {
            $tmp = tempnam(sys_get_temp_dir(), 'cbi-doc-');
            if ($tmp !== false) {
                $paths[$key] = $tmp;
            }
        }

        $responses = Http::pool(function (\Illuminate\Http\Client\Pool $pool) use ($urls, $paths) {
            $requests = [];
            foreach ($urls as $key => $url) {
                if (! isset($paths[$key])) {
                    continue;
                }
                // The URL is pre-signed, so it carries its own auth and must
                // not be sent through the Smartsheet token headers.
                $requests[] = $pool->as((string) $key)
                    ->withOptions(['sink' => $paths[$key]])
                    ->connectTimeout(15)
                    ->timeout(300)
                    ->get($url);
            }

            return $requests;
        });

        $ok = [];
        foreach ($paths as $key => $path) {
            $response = $responses[(string) $key] ?? null;
            // tempnam reuses paths and PHP caches stat results per path, so a
            // good file reads as zero bytes without this.
            clearstatcache(true, $path);
            $good = $response instanceof \Illuminate\Http\Client\Response
                && $response->successful()
                && file_exists($path) && filesize($path) > 0;

            if ($good) {
                $ok[$key] = $path;
            } else {
                @unlink($path);
            }
        }

        return $ok;
    }

    private function importOne(SmartsheetAttachment $attachment, ?string $url = null, ?string $tmpPath = null): void
    {
        $clientId = (int) $attachment->getAttribute('client_id');
        $applicationId = (int) $attachment->getAttribute('application_id');

        if (! $clientId) {
            $this->stats['orphaned']++;

            return;
        }

        if ($this->dryRun) {
            $this->stats['imported']++;
            $this->stats['bytes'] += (int) $attachment->size_kb * 1024;

            return;
        }

        try {
            $folderId = $this->folderFor($applicationId, $clientId);
            if (! $folderId) {
                $this->stats['orphaned']++;

                return;
            }

            // Minted in the batch above; fall back for the single-item paths
            // (a throttle retry, or a caller that did not batch).
            if (! $url) {
                $sheet = SmartsheetSheet::find($attachment->sheet_id);
                if (! $sheet) {
                    $this->stats['orphaned']++;

                    return;
                }
                $url = Smartsheet::attachmentUrl($sheet->remote_id, $attachment->remote_id);
            }

            if (! $url) {
                // A LINK-type row, or one Smartsheet no longer serves. Nothing
                // to mirror, and nothing gained by retrying it every run.
                $this->stats['links']++;

                return;
            }

            // Downloaded with the batch where possible; the single-file path
            // still exists for a throttle retry.
            $stored = $tmpPath
                ? $this->store($tmpPath, $attachment->name)
                : $this->download($url, $attachment->name);

            $file = FileItem::create([
                'uuid' => (string) Str::uuid(),
                'name' => $this->uniqueName($attachment->name, $folderId),
                'extension' => $stored['ext'],
                'mime_type' => $attachment->mime_type ?: $stored['mime'],
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'] ?? null,
                'folder_id' => $folderId,
                'owner_id' => $this->actor->id,
                'uploaded_by' => $this->actor->id,
            ]);

            // The link back is what makes the run resumable and what stops the
            // same document being filed twice.
            $attachment->forceFill(['file_id' => $file->id])->saveQuietly();

            $this->stats['imported']++;
            $this->stats['bytes'] += $stored['size'];
        } catch (SmartsheetThrottledException $e) {
            // Not a failure — the API asking for room. Wait it out and retry
            // this same attachment once before moving on.
            sleep(max(1, $e->retryAfter));
            try {
                $this->importOne($attachment);
            } catch (Throwable $inner) {
                $this->fail($attachment, $inner);
            }
        } catch (Throwable $e) {
            $this->fail($attachment, $e);
        }
    }

    private function fail(SmartsheetAttachment $attachment, Throwable $e): void
    {
        $this->stats['failed']++;
        if (count($this->errors) < 20) {
            $this->errors[] = $attachment->name.': '.$e->getMessage();
        }
    }

    /**
     * Stream the bytes to a temp file, then hand them to the Vault, which owns
     * where files live (R2 in production) and how they are named there.
     *
     * Throws rather than returning null so the reason reaches the run's error
     * list: "failed" with no explanation is the least useful thing an import
     * of twenty thousand files can tell you.
     *
     * @return array<string, mixed>
     */
    private function download(string $url, string $name): array
    {
        $tmp = tempnam(sys_get_temp_dir(), 'cbi-doc-');
        if ($tmp === false) {
            throw new \RuntimeException('could not make a temp file');
        }

        // The URL is a pre-signed S3 link, so it carries its own auth and must
        // not be sent through the Smartsheet client's token headers. `sink`
        // takes a path rather than a handle: given a handle, a faked or
        // redirected response can leave the bytes somewhere else entirely.
        $response = Http::withOptions(['sink' => $tmp, 'timeout' => 300])->get($url);

        // PHP caches stat results per path, and tempnam reuses paths that
        // earlier documents have already used and deleted.
        clearstatcache(true, $tmp);
        $size = file_exists($tmp) ? filesize($tmp) : 0;

        if (! $response->successful()) {
            @unlink($tmp);
            throw new \RuntimeException('download returned HTTP '.$response->status());
        }

        if (! $size) {
            @unlink($tmp);
            throw new \RuntimeException('download was empty');
        }

        return $this->store($tmp, $name);
    }

    /**
     * Hand a downloaded temp file to the Vault, which owns where files live
     * (R2 in production) and how they are named there.
     *
     * @return array<string, mixed>
     */
    private function store(string $tmp, string $name): array
    {
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION) ?: 'bin');
        $mime = mime_content_type($tmp) ?: null;

        // Vault::store() moves the temp file and returns where it landed.
        $stored = Vault::store($tmp, $ext);
        $stored['ext'] = $ext;
        $stored['mime'] = $mime;

        return $stored;
    }

    /** The client's main folder, made once per application and remembered. */
    private function folderFor(int $applicationId, int $clientId): ?int
    {
        if (isset($this->folders[$applicationId])) {
            return $this->folders[$applicationId];
        }

        $client = Client::find($clientId);
        if (! $client) {
            return null;
        }

        $before = $client->folder_id;
        $folder = FolderProvisioner::provisionClientFolder($client, $this->actor);
        if (! $before) {
            $this->stats['foldersCreated']++;
        }

        return $this->folders[$applicationId] = $folder->id;
    }

    /**
     * Smartsheet lets two rows carry the same filename; the File Library shows
     * one name per folder, so a collision gets a suffix rather than silently
     * hiding one of two different passports.
     */
    private function uniqueName(string $name, int $folderId): string
    {
        $name = trim($name) ?: 'Document';
        if (! FileItem::where('folder_id', $folderId)->where('name', $name)->exists()) {
            return $name;
        }

        $ext = pathinfo($name, PATHINFO_EXTENSION);
        $stem = $ext ? substr($name, 0, -(strlen($ext) + 1)) : $name;
        $n = 2;
        do {
            $candidate = $stem.' ('.$n.')'.($ext ? '.'.$ext : '');
            $n++;
        } while (FileItem::where('folder_id', $folderId)->where('name', $candidate)->exists());

        return $candidate;
    }
}
