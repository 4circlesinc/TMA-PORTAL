<?php

namespace App\Support\Cip;

use App\Models\CipProvider;
use App\Models\Company;
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

            return $provider;
        }

        return CipProvider::create([
            'name' => $company->name,
            'code' => $code,
            'company_id' => $company->id,
        ]);
    }

    /** The company's CIP code, if it has one. */
    public static function codeFor(Company $company): ?string
    {
        return CipProvider::where('company_id', $company->id)->value('code');
    }
}
