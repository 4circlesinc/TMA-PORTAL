<?php

namespace App\Http\Controllers;

use App\Jobs\SyncSharePointLibrary;
use App\Models\SharePointConnection;
use App\Support\Access\Role;
use App\Support\Imports\ImportPause;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Settings → Background Operations: what the portal is doing when nobody is
 * watching, read from the real queue rather than a list of examples.
 *
 * The queue is load-bearing here, mail import, calendar import, OneDrive
 * sync, notification email and every outbound message ride it, and its
 * characteristic failure is silence: with no worker running, jobs pile up and
 * every one of those features simply stops, with nothing on screen to say so.
 * So the page leads with whether work is actually moving, not just a list.
 */
class BackgroundOperationsController extends Controller
{
    /** A job that has sat unclaimed longer than this means nothing is draining. */
    private const STALL_SECONDS = 300;

    public function index(Request $request): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'settings.operations'), 403);

        $driver = config('queue.default');
        $imports = [
            'anyPaused' => ImportPause::any(),
            'updatedAt' => ImportPause::all()['updatedAt'] ?? null,
            'targets' => ImportPause::catalogue(),
        ];

        // Only the database queue can be inspected from here; anything else
        // (redis, sqs) keeps its state where we cannot read it cheaply.
        if ($driver !== 'database') {
            return response()->json([
                'driver' => $driver,
                'inspectable' => false,
                'pending' => [], 'failed' => [], 'health' => null,
                'imports' => $imports,
            ]);
        }

        $now = now();

        $pending = DB::table('jobs')
            ->orderBy('id')
            ->limit(50)
            ->get()
            ->map(fn ($job) => [
                'id' => $job->id,
                'name' => $this->jobName($job->payload),
                'queue' => $job->queue,
                'attempts' => (int) $job->attempts,
                'reserved' => $job->reserved_at !== null,
                'waitingSeconds' => max(0, $now->timestamp - (int) $job->available_at),
                'createdAt' => $this->iso($job->created_at),
            ]);

        $failed = DB::table('failed_jobs')
            ->orderByDesc('id')
            ->limit(25)
            ->get()
            ->map(fn ($job) => [
                'id' => $job->id,
                'uuid' => $job->uuid,
                'name' => $this->jobName($job->payload),
                'queue' => $job->queue,
                'failedAt' => $this->iso($job->failed_at),
                // The first line is the exception and message; the stack
                // trace below it is noise on a settings page.
                'error' => Str::limit(strtok((string) $job->exception, "\n"), 240),
            ]);

        $total = DB::table('jobs')->count();
        $oldest = DB::table('jobs')->min('available_at');
        $oldestWait = $oldest ? max(0, $now->timestamp - (int) $oldest) : 0;

        return response()->json([
            'driver' => $driver,
            'inspectable' => true,
            'pending' => $pending,
            'failed' => $failed,
            'imports' => $imports,
            'health' => [
                'pending' => $total,
                'failed' => DB::table('failed_jobs')->count(),
                'oldestWaitSeconds' => $oldestWait,
                // Work is queued and none of it has been picked up: either no
                // worker is running or it is wedged. This is the single most
                // useful fact on the page.
                'stalled' => $total > 0 && $oldestWait > self::STALL_SECONDS,
            ],
        ]);
    }

    /**
     * Pause or resume one import source. Smartsheet documents, OneDrive, or
     * a single SharePoint library. Mailbox and calendar sync stay on each
     * person's Connectors toggles.
     */
    public function pauseImports(Request $request): JsonResponse
    {
        abort_unless(Role::isAdmin($request->user()), 403);

        $libraryIds = collect(ImportPause::catalogue())
            ->where('kind', 'library')
            ->pluck('id')
            ->all();

        $data = $request->validate([
            'target' => [
                'required',
                'string',
                'max:80',
                Rule::in(array_merge(
                    [ImportPause::TARGET_SMARTSHEET, ImportPause::TARGET_ONEDRIVE],
                    $libraryIds,
                )),
            ],
            'paused' => ['required', 'boolean'],
        ]);

        ImportPause::putTarget($data['target'], (bool) $data['paused'], $request->user()?->id);

        return response()->json([
            'status' => 'ok',
            'target' => $data['target'],
            'paused' => (bool) $data['paused'],
            'imports' => [
                'anyPaused' => ImportPause::any(),
                'targets' => ImportPause::catalogue(),
            ],
        ]);
    }

    /**
     * Start one import source now instead of waiting for the scheduler.
     * Same targets as the pause switches; a paused source must be resumed
     * first so the button can never contradict the switch beside it.
     */
    public function runImport(Request $request): JsonResponse
    {
        abort_unless(Role::isAdmin($request->user()), 403);

        $libraryIds = collect(ImportPause::catalogue())
            ->where('kind', 'library')
            ->pluck('id')
            ->all();

        $data = $request->validate([
            'target' => [
                'required',
                'string',
                'max:80',
                Rule::in(array_merge(
                    [ImportPause::TARGET_SMARTSHEET, ImportPause::TARGET_ONEDRIVE],
                    $libraryIds,
                )),
            ],
        ]);

        $target = $data['target'];

        if ($target === ImportPause::TARGET_SMARTSHEET) {
            abort_if(ImportPause::smartsheet(), 422, 'Resume this import first.');
            // The command re-checks the feature flag, pause and token itself,
            // so queueing it dark is safe.
            Artisan::queue('smartsheet:sync', ['--queue' => true]);

            return response()->json(['status' => 'ok', 'queued' => 1]);
        }

        if ($target === ImportPause::TARGET_ONEDRIVE) {
            abort_if(ImportPause::onedrive(), 422, 'Resume this import first.');

            $ids = SharePointConnection::query()
                ->where('drive_kind', 'onedrive')
                ->where('sync_enabled', true)
                ->pluck('id');
            $ids->each(fn (int $id) => SyncSharePointLibrary::dispatch($id));

            return response()->json(['status' => 'ok', 'queued' => $ids->count()]);
        }

        $uuid = substr($target, strlen('library:'));
        abort_if(ImportPause::library($uuid), 422, 'Resume this import first.');

        $connection = SharePointConnection::query()
            ->where('uuid', $uuid)
            ->where('sync_enabled', true)
            ->firstOrFail();
        SyncSharePointLibrary::dispatch($connection->id);

        return response()->json(['status' => 'ok', 'queued' => 1]);
    }

    /** Put a failed job back on the queue, or throw it away. */
    public function retry(Request $request): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'settings.operations'), 403);

        $data = $request->validate([
            'uuid' => ['required', 'string', 'max:64'],
            'action' => ['required', 'string', 'in:retry,forget'],
        ]);

        $exists = DB::table('failed_jobs')->where('uuid', $data['uuid'])->exists();
        abort_unless($exists, 404, 'That job is no longer in the failed list.');

        Artisan::call($data['action'] === 'retry' ? 'queue:retry' : 'queue:forget', ['id' => [$data['uuid']]]);

        return response()->json(['status' => 'ok']);
    }

    /** Clear the whole failed list. */
    public function flush(Request $request): JsonResponse
    {
        abort_unless(Role::can($request->user(), 'settings.operations'), 403);

        $count = DB::table('failed_jobs')->count();
        DB::table('failed_jobs')->truncate();

        return response()->json(['status' => 'ok', 'cleared' => $count]);
    }

    /** The class name inside a serialized job payload. */
    private function jobName(?string $payload): string
    {
        $decoded = json_decode((string) $payload, true);
        $name = $decoded['displayName'] ?? ($decoded['job'] ?? 'Job');

        return class_basename(is_string($name) ? $name : 'Job');
    }

    private function iso($value): ?string
    {
        if ($value === null) {
            return null;
        }

        // `jobs` stores unix ints; `failed_jobs` stores a timestamp string.
        return is_numeric($value)
            ? \Illuminate\Support\Carbon::createFromTimestamp((int) $value)->toIso8601String()
            : \Illuminate\Support\Carbon::parse($value)->toIso8601String();
    }
}
