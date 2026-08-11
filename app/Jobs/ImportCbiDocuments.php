<?php

namespace App\Jobs;

use App\Models\User;
use App\Support\Cbi\DocumentImporter;
use App\Support\Cbi\SyncActor;
use App\Support\Imports\ImportPause;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Mirror a batch of Smartsheet FILE attachments into each client's folder.
 *
 * The full caseload is too large for one worker pass, so each run takes a
 * limited bite and re-queues itself while reachable documents remain. The
 * attachment's `file_id` makes every pass resumable.
 *
 * Filed documents are the same FileItems the Client hub Documents tab lists,
 * so opening one in CBI uses the portal lightbox with review status.
 */
class ImportCbiDocuments implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 900;

    /** How many documents one job attempt will try to file. */
    public const BATCH = 64;

    public function __construct(
        public ?int $actorId = null,
        public int $limit = self::BATCH,
    ) {
        $this->onQueue('cbi');
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('cbi:import-documents'))->dontRelease()->expireAfter(900)];
    }

    public function handle(): void
    {
        if (! config('services.smartsheet.cbi_enabled')) {
            return;
        }

        // Do not re-queue while paused — resume happens from SyncCbiHub /
        // Sync now once an administrator turns imports back on.
        if (ImportPause::active()) {
            return;
        }

        $actor = $this->actorId
            ? User::find($this->actorId)
            : SyncActor::resolve();

        $actor = SyncActor::resolve($actor);
        if (! $actor) {
            return;
        }

        $limit = max(1, $this->limit);
        $importer = new DocumentImporter($actor);
        $importer->import($limit);

        $survey = (new DocumentImporter($actor))->survey();
        $pending = max(0, $survey['files'] - $survey['orphaned']);

        if ($pending > 0 && ! ImportPause::active()) {
            self::dispatch($actor->id, $limit)->delay(now()->addSeconds(15));
        }
    }
}
