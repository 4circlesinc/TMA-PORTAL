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

        return response()->json([
            'ok' => true,
            'application' => [
                'id' => $primary->uuid,
                'provider' => $primary->provider?->name,
                'providerId' => $primary->provider?->uuid,
                'providerCode' => $primary->provider?->code,
            ],
            'moved' => collect($moved)->map(fn (CipApplication $app) => [
                'id' => $app->uuid,
                'number' => $app->displayNumber(),
                'provider' => $app->provider?->name,
                'providerId' => $app->provider?->uuid,
            ])->values()->all(),
            'message' => 'Application transferred to '.$to->name
                .'. The folder moved with it; the previous service provider no longer has access.',
        ]);
    }

    private function application(Request $request, string $uuid): CipApplication
    {
        return ApplicationScope::findOrFail($request->user(), $uuid);
    }
}
