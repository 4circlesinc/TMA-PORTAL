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
     * The code a provider of this name should get, free for the taking.
     *
     * Three letters of the name, which is what the firm says and what an
     * application number wears: LEVERA gives LEV. A code is never reissued,
     * so when LEV is spoken for the name gives up a fourth letter — LEVE —
     * and a fifth after that, before falling back to a numbered suffix. PRI
     * is reserved for the private-clients bucket and is never derived here.
     *
     * A name with too little in it to make three letters still gets a code:
     * two is enough to be a prefix, and 'SP' catches a name with no letters
     * at all rather than returning something empty.
     */
    public static function suggestCode(string $name): string
    {
        $squash = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $name));

        // Too little to make a prefix out of: 'X' is not a code anyone can
        // read in an application number. Pad rather than refuse the name.
        if (strlen($squash) < 2) {
            $squash = str_pad($squash, 2, 'SP');
        }

        /*
         * Three first, then a letter at a time. The shortest free code is the
         * one the firm finds easiest to say, and a longer slice of a name
         * that has run out of letters is the same slice again — so the walk
         * stops at the name's own length rather than retrying it.
         */
        $longest = min(8, max(2, strlen($squash)));

        for ($length = min(3, $longest); $length <= $longest; $length++) {
            $candidate = substr($squash, 0, $length);

            if ($candidate === CipProvider::PRIVATE_CLIENT_CODE) {
                continue;
            }

            if (! self::codeTaken($candidate)) {
                return $candidate;
            }
        }

        // Every slice of the name is spoken for — number it rather than
        // refuse, so creating a provider never dead-ends on its own name.
        $stem = substr($squash, 0, 3);
        for ($i = 2; $i < 1000; $i++) {
            $candidate = substr($stem, 0, max(1, 8 - strlen((string) $i))).$i;
            if (! self::codeTaken($candidate)) {
                return $candidate;
            }
        }

        return $stem.random_int(1000, 9999);
    }

    /**
     * Is this code spoken for?
     *
     * withTrashed, because a code is never reissued: it prefixes filed
     * application numbers and names a folder in the library long after its
     * provider is retired.
     */
    public static function codeTaken(string $code): bool
    {
        return CipProvider::withTrashed()
            ->whereRaw('UPPER(code) = ?', [strtoupper(trim($code))])
            ->exists();
    }

    /**
     * Register a company as a service provider, deriving its code when the
     * firm did not type one.
     *
     * Separate from syncCode because a blank there means "leave it alone",
     * which is what protects a code that already prefixes filed application
     * numbers. Only the act of creating a provider may mint one, and only
     * from its own name.
     */
    public static function register(Company $company, ?string $code): ?CipProvider
    {
        $code = strtoupper(trim((string) $code));

        if ($code === '' && ! CipProvider::where('company_id', $company->id)->exists()) {
            $code = self::suggestCode($company->name);
        }

        return self::syncCode($company, $code);
    }

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
