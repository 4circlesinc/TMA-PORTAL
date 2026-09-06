<?php

namespace App\Http\Controllers;

use App\Models\CallRecording;
use App\Models\CallRecordingAccessLog;
use App\Models\Client;
use App\Models\Conversation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Files\Vault;
use App\Support\Security\Envelope;
use App\Support\Security\SecurityAudit;
use App\Support\SecurityPolicies;
use App\Support\UserTime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Client-call recording: capture and the recordings area.
 *
 * Calls between a staff member and a client, or with a service provider
 * about an applicant, are recorded for the client's file; ordinary
 * staff-to-staff calls never are. The capture endpoints keep that rule
 * HERE, not in the browser: start() is a question every caller may ask,
 * and only the staff side of a call that belongs on a client file gets a
 * recording id back, so no client records anyone, and no browser can be
 * talked into recording a colleague.
 *
 * The audio/video itself arrives as sequenced WebM chunks while the call
 * runs (a recording that only uploads at hangup dies with a crashed tab).
 * Each chunk is stored as its own object on the files disk. R2 in
 * production. NOT appended to instance-local storage: a call can span a
 * deploy or an instance restart, and anything on local disk would vanish
 * mid-call. finish() assembles the pieces in sequence order into the Vault.
 * Streaming reads the disk from the ROW, never from config, the same rule
 * the attachment controller follows, so recordings survive a FILES_DISK
 * switch.
 *
 * Every call gets its OWN row, start() never resumes an earlier one. A
 * fresh MediaRecorder is a fresh WebM stream with its own init segment, so
 * "continuing" a previous row could only ever splice two incompatible
 * streams; a redial after a crash simply records again from zero.
 *
 * Consent is enforced by the client (§ messaging-calls.js): the recording
 * banner and the `state` signal go out before the recorder starts. This
 * controller records WHO was told by storing the participant list.
 */
class CallRecordingController extends Controller
{
    /** A single chunk is ~10s of opus/vp8, far below this, but leave room. */
    private const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

    /** Where a recording's chunk objects live until finish() assembles them. */
    private static function chunkDir(string $uuid): string
    {
        return 'call-recordings/tmp/'.$uuid;
    }

    /** The disk chunks are staged on, durable in production (R2). */
    private static function chunkDisk(): string
    {
        return config('filesystems.files_disk', 'local');
    }

    // ------------------------------------------------------------ capture

    /**
     * Arrange a recording for a connected call, if this call is one that
     * records. Answering `recording: null` is not an error, it is the
     * ordinary answer for every call that is not on a client file.
     */
    public function start(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();

        $conversation = Conversation::query()
            ->forUser($user)
            ->where('uuid', $uuid)
            ->firstOrFail();

        $data = $request->validate([
            'media' => ['nullable', 'string', 'in:audio,video'],
        ]);

        // The rule, in one place: a staff member talking to a client, or
        // talking to the service provider about an applicant. A tagged
        // conversation carries the applicant on `client_id`, so a call with
        // a provider contact is filed on that applicant rather than on the
        // contact's own row. Ordinary staff-to-staff calls still never record.
        $conversation->loadMissing(['client:id,uid,name,user_id', 'activeParticipants.user']);

        $counterpart = $conversation->isGroup() ? null : $conversation->counterpartFor($user);
        $aboutApplicant = $conversation->client_id !== null;
        $talkingToClient = $counterpart !== null && Role::isClient($counterpart);

        if (! Role::isStaff($user) || (! $aboutApplicant && ! $talkingToClient)) {
            return response()->json(['recording' => null]);
        }

        $clientId = $conversation->client_id
            ?: ($counterpart ? Client::query()->where('user_id', $counterpart->id)->value('id') : null);
        $clientName = $conversation->client?->name
            ?: ($counterpart?->name ?? 'Client');

        $participants = $conversation->activeParticipants
            ->map(fn ($p) => $p->user)
            ->filter()
            ->map(fn (User $u) => $this->participant($u))
            ->values()
            ->all();

        $recording = CallRecording::create([
            'uuid' => (string) Str::uuid(),
            'conversation_id' => $conversation->id,
            'client_id' => $clientId,
            'client_user_id' => $conversation->client?->user_id ?? $counterpart?->id,
            'recorded_by' => $user->id,
            'participants' => $participants !== []
                ? $participants
                : array_values(array_filter([
                    $this->participant($user),
                    $counterpart ? $this->participant($counterpart) : null,
                ])),
            'client_name' => $clientName,
            'media' => $data['media'] ?? 'audio',
            'status' => CallRecording::STATUS_RECORDING,
            'started_at' => now(),
        ]);

        return response()->json(['recording' => ['id' => $recording->uuid]], 201);
    }

    /**
     * One sequenced slice of the WebM stream. Stored as its own object, so a
     * duplicate retry overwrites itself harmlessly and order is settled at
     * assembly time rather than trusted to arrival.
     */
    public function chunk(Request $request, string $uuid): JsonResponse
    {
        $recording = $this->liveRecordingFor($request->user(), $uuid);

        $data = $request->validate([
            'seq' => ['required', 'integer', 'min:0', 'max:100000'],
            'chunk' => ['required', 'file', 'max:'.(self::MAX_CHUNK_BYTES / 1024)],
        ]);

        $seq = (int) $data['seq'];
        $bytes = $data['chunk']->get();

        Storage::disk(self::chunkDisk())->put(
            self::chunkDir($recording->uuid).'/'.$seq.'.part',
            $bytes,
        );

        $recording->forceFill([
            'last_seq' => max($recording->last_seq, $seq),
            'size' => $recording->size + strlen($bytes),
        ])->save();

        return response()->json(['ok' => true]);
    }

    /** Settle the row: assemble the chunks into the Vault, or mark it failed. */
    public function finish(Request $request, string $uuid): JsonResponse
    {
        $recording = $this->liveRecordingFor($request->user(), $uuid);

        $data = $request->validate([
            'durationMs' => ['nullable', 'integer', 'min:0'],
            'media' => ['nullable', 'string', 'in:audio,video'],
            'failed' => ['nullable', 'boolean'],
        ]);

        $temp = $this->assembleChunks($recording->uuid);

        if (! empty($data['failed']) || $temp === null) {
            if ($temp !== null) {
                @unlink($temp);
            }
            $this->dropChunks($recording->uuid);
            $recording->forceFill([
                'status' => CallRecording::STATUS_FAILED,
                'ended_at' => now(),
            ])->save();

            return response()->json(['ok' => true]);
        }

        $media = $data['media'] ?? $recording->media;
        $stored = Vault::store($temp, 'webm');
        $this->dropChunks($recording->uuid);

        $recording->forceFill([
            'status' => CallRecording::STATUS_READY,
            'media' => $media,
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            // Derived, never taken from the request: this string is served
            // back verbatim as Content-Type, and an attacker-chosen type
            // (text/html) would turn the media endpoint into a stored-XSS
            // page on the portal origin.
            'mime' => $media === 'video' ? 'video/webm' : 'audio/webm',
            'size' => $stored['size'],
            'duration_ms' => (int) ($data['durationMs'] ?? 0),
            'ended_at' => now(),
            'retain_until' => now()->addDays(SecurityPolicies::callRecordingRetentionDays()),
        ])->save();

        return response()->json(['ok' => true]);
    }

    /**
     * The staged chunk objects, concatenated in sequence order into a local
     * temp file ready for Vault::store. Null when nothing was captured.
     */
    private function assembleChunks(string $uuid): ?string
    {
        $disk = Storage::disk(self::chunkDisk());
        $parts = collect($disk->files(self::chunkDir($uuid)))
            ->filter(fn (string $p) => str_ends_with($p, '.part'))
            ->sortBy(fn (string $p) => (int) basename($p, '.part'))
            ->values();

        if ($parts->isEmpty()) {
            return null;
        }

        $temp = storage_path('app/call-recordings');
        @mkdir($temp, 0755, true);
        $temp .= '/'.$uuid.'.webm';

        $out = fopen($temp, 'wb');
        if ($out === false) {
            return null;
        }

        try {
            foreach ($parts as $part) {
                $in = $disk->readStream($part);
                if ($in === false || $in === null) {
                    continue;
                }
                stream_copy_to_stream($in, $out);
                fclose($in);
            }
        } finally {
            fclose($out);
        }

        return filesize($temp) > 0 ? $temp : null;
    }

    private function dropChunks(string $uuid): void
    {
        try {
            Storage::disk(self::chunkDisk())->deleteDirectory(self::chunkDir($uuid));
        } catch (\Throwable) {
            // Stray staging objects cost pennies; never fail a call over them.
        }
    }

    // ------------------------------------------------------------- area

    /**
     * The Client Call Recordings area. Admins see the firm's recordings;
     * an employee sees the calls they were on. Clients never reach this —
     * the capability 404s them at the route.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->areaUser($request);

        $query = CallRecording::query()->orderByDesc('started_at');

        if (! Role::isAdmin($user)) {
            $query->where('recorded_by', $user->id);
        }

        if ($clientId = $request->integer('clientId')) {
            $query->where('client_id', $clientId);
        }

        // Day boundaries in the READER's zone, the table renders dates on
        // their clock, and a filter that disagreed with the column it filters
        // would look simply broken (§ UserTime).
        $zone = UserTime::zone($user);
        foreach (['from' => '>=', 'to' => '<='] as $param => $op) {
            $raw = trim((string) $request->query($param, ''));
            if ($raw === '') {
                continue;
            }
            try {
                $bound = Carbon::parse($raw, $zone);
            } catch (\Throwable) {
                continue;
            }
            $bound = $param === 'from' ? $bound->startOfDay() : $bound->endOfDay();
            $query->where('started_at', $op, $bound->utc());
        }

        if ($term = trim((string) $request->query('q', ''))) {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';
            // ilike on Postgres, plain LIKE is case-sensitive there, and a
            // search box that cares about capitalisation reads as broken
            // (the Clients directory learned this the hard way).
            $operator = DB::connection()->getDriverName() === 'pgsql' ? 'ilike' : 'like';
            $query->where('client_name', $operator, $like);
        }

        $page = max(1, $request->integer('page', 1));
        $perPage = 50;
        $total = (clone $query)->count();

        $rows = $query->forPage($page, $perPage)->get();

        // The filter dropdown's options: every client this viewer has
        // recordings with, independent of the current filters.
        $clientsQuery = CallRecording::query()
            ->whereNotNull('client_id');
        if (! Role::isAdmin($user)) {
            $clientsQuery->where('recorded_by', $user->id);
        }
        $clients = $clientsQuery
            ->select('client_id', 'client_name')
            ->distinct()
            ->orderBy('client_name')
            ->get()
            ->map(fn ($r) => ['id' => $r->client_id, 'name' => $r->client_name])
            ->values();

        return response()->json([
            'recordings' => $rows->map(fn (CallRecording $r) => $this->record($r))->values(),
            'clients' => $clients,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /**
     * Play or download one recording; the disk comes from the row. Handles a
     * single byte Range so the player can seek a long recording instead of
     * downloading it front to back.
     */
    public function media(Request $request, string $uuid): StreamedResponse
    {
        $user = $this->areaUser($request);

        $query = CallRecording::query()
            ->where('uuid', $uuid)
            ->where('status', CallRecording::STATUS_READY);
        if (! Role::isAdmin($user)) {
            $query->where('recorded_by', $user->id);
        }
        $recording = $query->firstOrFail();

        abort_unless($recording->disk && $recording->path, 404);

        $storage = Storage::disk($recording->disk);
        abort_unless($storage->exists($recording->path), 404);

        $plain = Envelope::materializeDisk($storage, $recording->path);
        abort_unless($plain && is_file($plain), 404);

        $total = filesize($plain) ?: 0;
        $download = $request->boolean('download');
        $name = $this->fileName($recording);

        CallRecordingAccessLog::create([
            'call_recording_id' => $recording->id,
            'user_id' => $user->id,
            'action' => $download ? 'download' : 'play',
            'ip' => $request->ip(),
            'created_at' => now(),
        ]);
        SecurityAudit::record('call_recording.'.($download ? 'download' : 'play'), [
            'uuid' => $recording->uuid,
            'user_id' => $user->id,
        ]);

        $start = 0;
        $end = max(0, $total - 1);
        $partial = false;
        $range = (string) $request->header('Range', '');
        if (! $download && preg_match('/^bytes=(\d+)-(\d*)$/', $range, $m)) {
            $start = (int) $m[1];
            $end = $m[2] === '' ? $total - 1 : min((int) $m[2], $total - 1);
            if ($start > $end || $start >= $total) {
                @unlink($plain);
                abort(416, 'Range not satisfiable');
            }
            $partial = true;
        }

        $headers = [
            'Content-Type' => $recording->mime ?: 'application/octet-stream',
            'Content-Length' => (string) ($end - $start + 1),
            'Content-Disposition' => ($download ? 'attachment' : 'inline').'; filename="'.$name.'"',
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ];
        if ($partial) {
            $headers['Content-Range'] = 'bytes '.$start.'-'.$end.'/'.$total;
        }

        return response()->stream(function () use ($plain, $start, $end) {
            try {
                $handle = fopen($plain, 'rb');
                if ($handle === false) {
                    return;
                }
                if ($start > 0) {
                    fseek($handle, $start);
                }
                $remaining = $end - $start + 1;
                while ($remaining > 0 && ! feof($handle)) {
                    $piece = fread($handle, min($remaining, 1 << 16));
                    if ($piece === false || $piece === '') {
                        break;
                    }
                    echo $piece;
                    $remaining -= strlen($piece);
                }
                fclose($handle);
            } finally {
                @unlink($plain);
            }
        }, $partial ? 206 : 200, $headers);
    }

    /** Keep a recording past retention (administrators). */
    public function hold(Request $request, string $uuid): JsonResponse
    {
        $user = $this->areaUser($request);
        abort_unless(Role::isAdmin($user), 404);

        $recording = CallRecording::query()
            ->where('uuid', $uuid)
            ->firstOrFail();

        $on = $request->boolean('legalHold', true);
        $recording->forceFill(['legal_hold' => $on])->save();

        return response()->json($this->record($recording));
    }

    // ----------------------------------------------------------- helpers

    /** The area is staff tooling: absent, not forbidden, to anyone else. */
    private function areaUser(Request $request): User
    {
        $user = $request->user();
        abort_unless($user && Role::can($user, 'callRecordings.view'), 404);

        return $user;
    }

    /** A capture endpoint only ever serves the person doing the recording. */
    private function liveRecordingFor(User $user, string $uuid): CallRecording
    {
        return CallRecording::query()
            ->where('uuid', $uuid)
            ->where('recorded_by', $user->id)
            ->where('status', CallRecording::STATUS_RECORDING)
            ->firstOrFail();
    }

    /** @return array{id:int, name:string, accountType:string} */
    private function participant(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'accountType' => (string) $user->account_type,
        ];
    }

    /** @return array<string, mixed> */
    private function record(CallRecording $r): array
    {
        $status = $r->status === CallRecording::STATUS_RECORDING && $r->isInterrupted()
            ? 'interrupted'
            : $r->status;

        return [
            'id' => $r->uuid,
            'clientId' => $r->client_id,
            'clientUid' => $r->client_id ? $r->client?->uid : null,
            'clientName' => $r->client_name,
            'participants' => $r->participants ?: [],
            'media' => $r->media,
            'status' => $status,
            'size' => (int) $r->size,
            'durationMs' => (int) $r->duration_ms,
            // ISO instants; the reading browser renders them in its own zone
            // (§ mail-thread rule: never ship pre-formatted clock times).
            'startedAt' => $r->started_at?->toIso8601String(),
            'endedAt' => $r->ended_at?->toIso8601String(),
            'conversationId' => $r->conversation?->uuid,
            'legalHold' => (bool) $r->legal_hold,
            'retainUntil' => $r->retain_until?->toIso8601String(),
        ];
    }

    /** "John Smith - Client Call - 2026-08-10 - 34m21s.webm" for downloads. */
    private function fileName(CallRecording $r): string
    {
        $secs = intdiv((int) $r->duration_ms, 1000);
        $length = sprintf('%dm%02ds', intdiv($secs, 60), $secs % 60);
        $name = $r->client_name.' - Client Call - '
            .($r->started_at?->format('Y-m-d H.i') ?? 'unknown').' - '.$length.'.webm';

        return str_replace(['"', '/', '\\'], '', $name);
    }
}
