<?php

namespace App\Http\Controllers;

use App\Models\CallRecording;
use App\Models\Client;
use App\Models\Conversation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Client-call recording: capture and the recordings area.
 *
 * Calls between a staff member and a client are recorded for the client's
 * file; ordinary staff-to-staff calls never are. The capture endpoints keep
 * that rule HERE, not in the browser: start() is a question every caller may
 * ask, and only the staff side of a direct staff↔client call gets a
 * recording id back — so no client records anyone, and no browser can be
 * talked into recording a colleague.
 *
 * The audio/video itself arrives as sequenced WebM chunks while the call
 * runs (a recording that only uploads at hangup dies with a crashed tab),
 * assembled in local temp storage and moved into the Vault — R2 in
 * production — when the recorder finishes. Streaming reads the disk from
 * the ROW, never from config, the same rule the attachment controller
 * follows, so recordings survive a FILES_DISK switch.
 *
 * Consent is enforced by the client (§ messaging-calls.js): the recording
 * banner and the `state` signal go out before the recorder starts. This
 * controller records WHO was told by storing the participant list.
 */
class CallRecordingController extends Controller
{
    /** A single chunk is ~10s of opus/vp8 — far below this, but leave room. */
    private const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

    /** Where chunks accumulate until finish() moves them into the Vault. */
    private static function tempPath(string $uuid): string
    {
        return storage_path('app/call-recordings/'.$uuid.'.webm');
    }

    // ------------------------------------------------------------ capture

    /**
     * Arrange a recording for a connected call, if this call is one that
     * records. Answering `recording: null` is not an error — it is the
     * ordinary answer for every call that is not staff↔client.
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

        // The rule, in one place: a staff member, in a direct conversation,
        // talking to a client account.
        $counterpart = $conversation->isGroup() ? null : $conversation->counterpartFor($user);

        if (! Role::isStaff($user) || ! $counterpart || ! Role::isClient($counterpart)) {
            return response()->json(['recording' => null]);
        }

        // One live recording per conversation: if this staff member's tab
        // reconnected mid-call, resume the row instead of forking a second.
        $existing = CallRecording::query()
            ->where('conversation_id', $conversation->id)
            ->where('recorded_by', $user->id)
            ->where('status', CallRecording::STATUS_RECORDING)
            ->where('updated_at', '>', now()->subMinutes(5))
            ->first();

        if ($existing) {
            return response()->json(['recording' => ['id' => $existing->uuid]]);
        }

        $recording = CallRecording::create([
            'uuid' => (string) Str::uuid(),
            'conversation_id' => $conversation->id,
            'client_id' => Client::query()->where('user_id', $counterpart->id)->value('id'),
            'client_user_id' => $counterpart->id,
            'recorded_by' => $user->id,
            'participants' => [
                $this->participant($user),
                $this->participant($counterpart),
            ],
            'client_name' => $counterpart->name,
            'media' => $data['media'] ?? 'audio',
            'status' => CallRecording::STATUS_RECORDING,
            'started_at' => now(),
        ]);

        return response()->json(['recording' => ['id' => $recording->uuid]], 201);
    }

    /** One sequenced slice of the WebM stream, appended in arrival order. */
    public function chunk(Request $request, string $uuid): JsonResponse
    {
        $recording = $this->liveRecordingFor($request->user(), $uuid);

        $data = $request->validate([
            'seq' => ['required', 'integer', 'min:0'],
            'chunk' => ['required', 'file', 'max:'.(self::MAX_CHUNK_BYTES / 1024)],
        ]);

        $seq = (int) $data['seq'];

        // A retried chunk whose first attempt actually landed must not be
        // written twice — order and continuity ARE the file.
        if ($seq <= $recording->last_seq) {
            return response()->json(['ok' => true]);
        }

        $path = self::tempPath($recording->uuid);
        @mkdir(dirname($path), 0755, true);

        $bytes = $data['chunk']->get();
        if (file_put_contents($path, $bytes, FILE_APPEND) === false) {
            abort(500, 'The recording could not be written.');
        }

        $recording->forceFill([
            'last_seq' => $seq,
            'size' => $recording->size + strlen($bytes),
        ])->save();

        return response()->json(['ok' => true]);
    }

    /** Settle the row: move the assembled file into the Vault, or mark it failed. */
    public function finish(Request $request, string $uuid): JsonResponse
    {
        $recording = $this->liveRecordingFor($request->user(), $uuid);

        $data = $request->validate([
            'durationMs' => ['nullable', 'integer', 'min:0'],
            'media' => ['nullable', 'string', 'in:audio,video'],
            'mime' => ['nullable', 'string', 'max:100'],
            'failed' => ['nullable', 'boolean'],
        ]);

        $temp = self::tempPath($recording->uuid);
        $hasBytes = is_file($temp) && filesize($temp) > 0;

        if (! empty($data['failed']) || ! $hasBytes) {
            if (is_file($temp)) {
                @unlink($temp);
            }
            $recording->forceFill([
                'status' => CallRecording::STATUS_FAILED,
                'ended_at' => now(),
            ])->save();

            return response()->json(['ok' => true]);
        }

        $media = $data['media'] ?? $recording->media;
        $stored = Vault::store($temp, 'webm');

        $recording->forceFill([
            'status' => CallRecording::STATUS_READY,
            'media' => $media,
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            'mime' => $data['mime'] ?? ($media === 'video' ? 'video/webm' : 'audio/webm'),
            'size' => $stored['size'],
            'duration_ms' => (int) ($data['durationMs'] ?? 0),
            'ended_at' => now(),
        ])->save();

        return response()->json(['ok' => true]);
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

        if ($from = $request->date('from')) {
            $query->where('started_at', '>=', $from->startOfDay());
        }

        if ($to = $request->date('to')) {
            $query->where('started_at', '<=', $to->endOfDay());
        }

        if ($term = trim((string) $request->query('q', ''))) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $term).'%';
            $query->where('client_name', 'like', $like);
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

    /** Play or download one recording; the disk comes from the row. */
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

        $download = $request->boolean('download');
        $name = $this->fileName($recording);

        return response()->stream(function () use ($storage, $recording) {
            $handle = $storage->readStream($recording->path);
            if ($handle === false || $handle === null) {
                return;
            }
            fpassthru($handle);
            fclose($handle);
        }, 200, [
            'Content-Type' => $recording->mime ?: 'application/octet-stream',
            'Content-Length' => (string) $storage->size($recording->path),
            'Content-Disposition' => ($download ? 'attachment' : 'inline').'; filename="'.$name.'"',
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
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
        ];
    }

    /** "John Smith — Client Call — 2026-08-10 — 34m21s.webm" for downloads. */
    private function fileName(CallRecording $r): string
    {
        $secs = intdiv((int) $r->duration_ms, 1000);
        $length = sprintf('%dm%02ds', intdiv($secs, 60), $secs % 60);
        $name = $r->client_name.' — Client Call — '
            .($r->started_at?->format('Y-m-d H.i') ?? 'unknown').' — '.$length.'.webm';

        return str_replace(['"', '/', '\\'], '', $name);
    }
}
