<?php

namespace App\Console\Commands;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipProvider;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\Numbering;
use App\Support\Cip\Phase;
use App\Support\Cip\ProviderTransfer;
use App\Support\Cip\Tree;
use App\Support\Realtime\Live;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

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
 * Two kinds of file, and only those:
 *
 *  - one a person transferred: a transfer in its audit trail, and a number
 *    that is not in its present firm's shape;
 *  - an Add-On that took its main application's firm when the two were
 *    linked. That link used to write the firm and nothing else, no audit
 *    row and no new number, and on the filing path it left the folder in
 *    the first firm's drawer too, so these are found by what they are: an
 *    Add-On under its parent's firm wearing the code of another firm that
 *    is still on the register.
 *
 * A file that a register merge moved between two rows of the same firm is
 * neither. It has no transfer in its trail, the row whose code it wears is
 * off the register, and it deliberately keeps its number
 * ({@see \App\Support\Cip\ProviderMerge}).
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
            $this->info('Every moved application already wears its firm’s number.');

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
     * The files moved under the old rule, still wearing a number that is not
     * in their present firm's shape. See the class comment for the two kinds.
     *
     * @return Collection<int, CipApplication>
     */
    private function stale(): Collection
    {
        $misnumbered = fn (CipApplication $application) => $application->provider !== null
            && ! Numbering::matches($application->provider, (string) $application->internal_number);

        $transferred = CipApplication::query()
            ->with('provider')
            ->whereIn('id', CipEvent::query()
                ->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)
                ->select('application_id'))
            ->get()
            ->filter($misnumbered);

        // Soft-deleted rows are off the register and out of this list, which
        // is what keeps a merged firm's leftovers from reading as followers.
        $register = CipProvider::query()->get();

        $followed = CipApplication::query()
            ->with(['provider', 'parent'])
            ->where('phase', Phase::ADD_ON)
            ->whereNotNull('parent_application_id')
            ->get()
            ->filter(fn (CipApplication $addOn) => $addOn->parent !== null
                && (int) $addOn->provider_id === (int) $addOn->parent->provider_id
                && $misnumbered($addOn)
                && $register->contains(fn (CipProvider $firm) => (int) $firm->id !== (int) $addOn->provider_id
                    && Numbering::matches($firm, (string) $addOn->internal_number)));

        return $transferred->concat($followed)->unique('id')->sortBy('id')->values();
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

            // The filing path of the old link left the Add-On's folder in
            // the first firm's drawer. A no-op where it is already home; a
            // folder that cannot be moved does not hold the number back.
            try {
                $row->loadMissing('client.folder');
                ProviderTransfer::reparentClientFolder($row, $row->provider);
            } catch (ValidationException) {
                $this->warn($previous.': the folder could not be moved; the number was still issued.');
            }

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
