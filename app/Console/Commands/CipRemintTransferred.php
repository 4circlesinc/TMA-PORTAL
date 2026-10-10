<?php

namespace App\Console\Commands;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\Numbering;
use App\Support\Cip\Tree;
use App\Support\Realtime\Live;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Number again the applications that changed firm before numbers followed
 * the firm.
 *
 * Until October 2026 a transfer to another service provider kept the
 * application's number, so a file moved from Galaxy to iGraphix went on
 * wearing GAL26-00001 under a firm whose code is IGA. Transfers number the
 * file again now ({@see \App\Support\Cip\ProviderTransfer::rehome}); this
 * does the same, once, for the files that were moved before that.
 *
 * Only files a person transferred: the ones with a transfer in their audit
 * trail whose number is not in their present firm's shape. A file that a
 * register merge moved between two rows of the same firm has no such row
 * and deliberately keeps its number ({@see \App\Support\Cip\ProviderMerge}).
 *
 * Lists what it would change and writes nothing unless `--apply` is given.
 * Safe to run twice: a file numbered again no longer matches.
 */
class CipRemintTransferred extends Command
{
    protected $signature = 'cip:remint-transferred
        {--apply : Write the new numbers. Without it, only list what would change}';

    protected $description = 'Number again the applications that changed service provider before numbers followed the firm';

    public function handle(): int
    {
        $stale = $this->stale();

        if ($stale->isEmpty()) {
            $this->info('Every transferred application already wears its firm’s number.');

            return self::SUCCESS;
        }

        $apply = (bool) $this->option('apply');
        $rows = [];

        foreach ($stale as $application) {
            $previous = (string) $application->internal_number;
            $number = $apply ? $this->remint($application) : null;

            if ($apply && $number === null) {
                continue;
            }

            $rows[] = [
                $previous,
                $apply ? $number : 'next free '.$application->provider->code.' number',
                $application->provider->name,
                (string) ($application->cip_number ?? ''),
            ];
        }

        $this->table(['Number', $apply ? 'Now' : 'Would become', 'Service provider', 'CIP number'], $rows);

        if (! $apply) {
            $this->line(count($rows).' application(s) would be numbered again. Run with --apply to write.');

            return self::SUCCESS;
        }

        Live::staff(Live::CIP);
        $this->info(count($rows).' application(s) numbered again.');

        return self::SUCCESS;
    }

    /**
     * Transferred by a person, and still wearing a number that is not in
     * the present firm's shape.
     *
     * @return Collection<int, CipApplication>
     */
    private function stale(): Collection
    {
        return CipApplication::query()
            ->with('provider')
            ->whereIn('id', CipEvent::query()
                ->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)
                ->select('application_id'))
            ->orderBy('id')
            ->get()
            ->filter(fn (CipApplication $application) => $application->provider !== null
                && ! Numbering::matches($application->provider, (string) $application->internal_number))
            ->values();
    }

    /** The new number, or null when the row moved on while this was running. */
    private function remint(CipApplication $application): ?string
    {
        return DB::transaction(function () use ($application) {
            $row = CipApplication::query()
                ->with('provider')
                ->whereKey($application->id)
                ->lockForUpdate()
                ->first();

            if ($row === null || $row->provider === null) {
                return null;
            }

            $previous = (string) $row->internal_number;
            $number = Applications::numberUnder($row, $row->provider);

            if ($number === $previous) {
                return null;
            }

            $row->forceFill(['internal_number' => $number])->save();
            Tree::followNumber($row, $previous);

            // No actor: nobody chose this number. The trail reads "the
            // system changed the application number from … to …".
            Engine::record($row, CipEvent::ACTION_RENUMBERED, null, [
                'internalNumber' => $number,
                'previousInternalNumber' => $previous,
                'reason' => 'provider_changed',
            ]);

            return $number;
        });
    }
}
