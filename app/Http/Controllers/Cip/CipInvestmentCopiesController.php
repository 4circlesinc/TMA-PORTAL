<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipProvider;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Intake;
use App\Support\Cip\InvestmentCopies;
use App\Support\Cip\InvestmentType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Settings › CIP Console › Investment Copies.
 *
 * Per investment type, the service providers and extra mailboxes copied on
 * every notice, whichever firm filed the application. Readable by anyone who
 * may reach the module; changeable only with cip.configure.
 */
class CipInvestmentCopiesController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        return response()->json([
            'canEdit' => CipAccess::can($user, 'cip.configure'),
            'investmentTypes' => InvestmentType::options(),
            'providers' => Intake::providersFor($user)
                ->map(fn (CipProvider $p) => ['id' => $p->uuid, 'name' => $p->name, 'code' => $p->code])
                ->values(),
            'copies' => InvestmentCopies::all(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);
        abort_unless(CipAccess::can($user, 'cip.configure'), 403, 'Only an administrator can change who is copied.');

        $data = $request->validate([
            'copies' => ['present', 'array'],
            'copies.*' => ['array'],
            'copies.*.providerIds' => ['nullable', 'array', 'max:50'],
            'copies.*.providerIds.*' => ['nullable', 'string', 'max:64'],
            'copies.*.emails' => ['nullable', 'array', 'max:50'],
            'copies.*.emails.*' => ['nullable', 'string', 'max:191'],
        ]);

        $copies = InvestmentCopies::put($data['copies'], $user->id);

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'cip.investment_copies_updated',
            'module' => 'cip',
            'description' => 'CIP investment copy lists updated',
            'new' => ['copies' => $copies],
        ]);

        return $this->show($request);
    }
}
