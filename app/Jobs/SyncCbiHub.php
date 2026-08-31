<?php

namespace App\Jobs;

use App\Models\User;
use App\Support\Cbi\ClientHubImporter;
use App\Support\Clients\ClientDirectory;
use Illuminate\Support\Facades\Cache;
use App\Support\Cbi\SyncActor;
use App\Support\Imports\ImportPause;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * After Smartsheet metadata lands, bring the caseload into the Client hub
 * and queue the paperwork for each client's File Library folder.
 *
 * Sheet sync alone leaves attachments as names and sizes. The office expects
 * the same file under the person in Clients — this is the step that creates
 * those client records, ensures every linked client has a folder, and then
 * kicks off the byte import so CBI Documents and the Client hub open the
 * same file in the portal lightbox.
 */
class SyncCbiHub implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 600;

    public function __construct(
        public ?int $actorId = null,
    ) {
        /*
         * Used to ride a separate 'cbi' queue to keep clear of the crowded
         * default — but the production worker only ever serves the connection
         * default, so 'cbi' starved for hours (2026-08-31). With five worker
         * processes and chunked jobs, one shared queue is the arrangement
         * that actually runs.
         */
    }

    public function middleware(): array
    {
        return [(new WithoutOverlapping('cbi:sync-hub'))->dontRelease()->expireAfter(600)];
    }

    public function handle(): void
    {
        if (! config('services.smartsheet.cbi_enabled')) {
            return;
        }

        if (ImportPause::smartsheet()) {
            return;
        }

        $actor = $this->actorId
            ? User::find($this->actorId)
            : SyncActor::resolve();

        $actor = SyncActor::resolve($actor);
        if (! $actor) {
            return;
        }

        $importer = new ClientHubImporter($actor, dryRun: false, withFolders: true);
        $importer->registerCompanies();
        $importer->importClients();
        // Already-linked clients from earlier imports still need folders.
        $importer->provisionMissingFolders();

        ClientDirectory::flush();
        Cache::forget('companies.directory');
        Cache::forget('cbi.summary.core');

        ImportCbiDocuments::dispatch($actor->id);
    }
}
