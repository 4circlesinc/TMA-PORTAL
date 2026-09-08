<?php

namespace App\Console\Commands;

use App\Models\CipProvider;
use App\Models\Folder;
use App\Support\Cip\Providers;
use Illuminate\Console\Command;

/**
 * Mirror the Citizenship Applications library's top-level folders into CIP
 * service providers: one provider per named folder, linked to it, with a
 * generated code an administrator refines later.
 *
 * Idempotent by name — an existing provider is linked, never duplicated, and
 * a rerun with nothing new writes nothing — so the scheduler can run it after
 * the SharePoint sync and a provider folder created over there becomes a
 * provider here on its own.
 */
class CipProvidersFromFolders extends Command
{
    protected $signature = 'cip:providers-from-folders
        {--library=Citizenship Applications : Organization folder whose children are the provider folders}';

    protected $description = 'Create and link CIP service providers from the provider folders in the library';

    public function handle(): int
    {
        $root = Folder::query()
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower((string) $this->option('library'))])
            ->first();

        if (! $root) {
            $this->error('No organization folder called "'.$this->option('library').'".');

            return self::FAILURE;
        }

        $made = 0;
        $linked = 0;

        Folder::query()
            ->where('parent_id', $root->id)
            ->orderBy('name')
            ->get()
            ->each(function (Folder $folder) use (&$made, &$linked) {
                $name = trim($folder->name);
                if ($name === '') {
                    return;
                }

                $provider = CipProvider::query()
                    ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                    ->first();

                if (! $provider) {
                    $provider = CipProvider::create([
                        'name' => $name,
                        'code' => $this->uniqueCode($name),
                        'folder_id' => $folder->id,
                        'active' => true,
                    ]);
                    $made++;
                    $this->line('  + '.str_pad($provider->code, 6).$name);

                    return;
                }

                if (! $provider->folder_id) {
                    $provider->forceFill(['folder_id' => $folder->id])->save();
                    $linked++;
                    $this->line('  ~ linked '.$name);
                } elseif ((int) $provider->folder_id !== (int) $folder->id) {
                    // Two folders wearing one name: the first claimed the
                    // provider; this one needs a person to decide.
                    $this->warn('  ! '.$name.' is already linked to another folder; folder #'.$folder->id.' skipped.');
                }
            });

        $this->info($made.' provider(s) created, '.$linked.' linked.');

        return self::SUCCESS;
    }

    /**
     * A short number prefix from the name — GALAXY gives the GAL that
     * application numbers already wear — unique among providers. PRI stays
     * reserved for the private-clients bucket, which is the one folder
     * allowed to generate it.
     *
     * The derivation itself lives in Providers::suggestCode, so a provider
     * born from a folder is numbered exactly like one created in the hub.
     */
    private function uniqueCode(string $name): string
    {
        $isPrivate = in_array(mb_strtolower($name), ['private', 'private client', 'private clients'], true);

        if ($isPrivate && ! Providers::codeTaken(CipProvider::PRIVATE_CLIENT_CODE)) {
            return CipProvider::PRIVATE_CLIENT_CODE;
        }

        return Providers::suggestCode($name);
    }
}
