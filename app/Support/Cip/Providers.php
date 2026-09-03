<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use App\Models\Company;
use App\Models\Folder;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The bridge between service providers as the firm sees them, company
 * records in the Client Hub, and the numbering registry the CIP module
 * needs. There is no separate provider screen: giving a company a CIP code
 * on its own page is what makes it a provider, and the cip_providers row is
 * invisible plumbing that carries the code and the number sequences.
 */
class Providers
{
    /**
     * Set or change the company's CIP code. An empty code is a no-change —
     * codes prefix minted application numbers, so they are never silently
     * cleared, and never changed once numbers exist under them.
     */
    public static function syncCode(Company $company, ?string $code): ?CipProvider
    {
        $code = strtoupper(trim((string) $code));
        $provider = CipProvider::where('company_id', $company->id)->first();

        if ($code === '' || $code === $provider?->code) {
            // Keep the shadow row's name following the company's.
            if ($provider && $provider->name !== $company->name) {
                $provider->forceFill(['name' => $company->name])->save();
            }

            return $provider;
        }

        if ($provider && $provider->applications()->exists()) {
            throw ValidationException::withMessages([
                'cipCode' => 'This provider already has numbered applications; its code cannot change.',
            ]);
        }

        $taken = CipProvider::where('code', $code)
            ->when($provider, fn ($q) => $q->whereKeyNot($provider->id))
            ->exists();

        if ($taken) {
            throw ValidationException::withMessages([
                'cipCode' => 'That CIP code is already in use.',
            ]);
        }

        if ($provider) {
            $provider->forceFill(['code' => $code, 'name' => $company->name])->save();
            self::ensureFolder($provider);

            return $provider;
        }

        $provider = CipProvider::create([
            'name' => $company->name,
            'code' => $code,
            'company_id' => $company->id,
        ]);

        self::ensureFolder($provider);

        return $provider;
    }

    /**
     * Every provider gets its folder in the Citizenship Applications library.
     *
     * Folders used to flow one way only - cip:providers-from-folders turns
     * library folders into providers - so a provider born here, by a company
     * being given a CIP code, had nowhere for its documents. A same-named
     * folder already under the root is adopted rather than duplicated (the
     * sync may have imported it first); a new one is created through the
     * model on purpose, so the SharePoint observer pushes it out and the
     * real library grows the folder too.
     */
    public static function ensureFolder(CipProvider $provider): void
    {
        if ($provider->folder_id && Folder::whereKey($provider->folder_id)->exists()) {
            return;
        }

        $root = Folder::query()
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', ['citizenship applications'])
            ->first();

        if (! $root) {
            // No library (a fresh install, a test rig): the provider works
            // without a folder, exactly as before.
            return;
        }

        $folder = Folder::query()
            ->where('parent_id', $root->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($provider->name)])
            ->first();

        $folder ??= Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $provider->name,
            'parent_id' => $root->id,
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $root->owner_id,
            'created_by' => $root->owner_id,
        ]);

        $provider->forceFill(['folder_id' => $folder->id])->save();
    }

    /** The company's CIP code, if it has one. */
    public static function codeFor(Company $company): ?string
    {
        return CipProvider::where('company_id', $company->id)->value('code');
    }
}
