<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\ProviderTransfer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Hand a CIP application to a different service provider.
 *
 * Administrators only. The body must confirm the folder move and the access
 * loss for the outgoing firm — a silent transfer would leave papers under
 * the wrong drawer and would cut the old firm off without warning.
 */
class CipProviderTransferController extends Controller
{
    public function store(Request $request, string $uuid): JsonResponse
    {
        $application = $this->application($request, $uuid);
        abort_unless(CipAccess::canTransferProvider($request->user()), 403);

        $data = $request->validate([
            'providerId' => ['required', 'string', Rule::exists('cip_providers', 'uuid')],
            'confirm' => ['accepted'],
        ], [
            'confirm.accepted' => 'Confirm that the application folder will move and the current service provider will lose access.',
        ]);

        $to = CipProvider::query()->where('uuid', $data['providerId'])->firstOrFail();

        $moved = ProviderTransfer::transfer(
            $application,
            $to,
            $request->user(),
            confirmed: true,
        );

        $primary = collect($moved)->firstWhere('id', $application->id) ?? $moved[0] ?? $application->fresh();
        $primary->loadMissing(['provider', 'client']);

        /*
         * Every moved file, with the number it wears now. `internalNumber`
         * is the one that changed with the firm; `number` is what the screen
         * displays, which is the Unit's CIP number once there is one and
         * does not move. A browser patching its rows needs both, and needs
         * the client the row belongs under to find what it is holding.
         */
        $describe = fn (CipApplication $app) => [
            'id' => $app->uuid,
            'clientUid' => $app->client?->uid,
            'number' => $app->displayNumber(),
            'internalNumber' => $app->internal_number,
            'provider' => $app->provider?->name,
            'providerId' => $app->provider?->uuid,
            'providerCode' => $app->provider?->code,
        ];

        return response()->json([
            'ok' => true,
            'application' => $describe($primary),
            'moved' => collect($moved)->map($describe)->values()->all(),
            'message' => 'Transferred to '.$to->name.'; the application number is now '.$primary->internal_number.'.',
        ]);
    }

    private function application(Request $request, string $uuid): CipApplication
    {
        return ApplicationScope::findOrFail($request->user(), $uuid);
    }
}
