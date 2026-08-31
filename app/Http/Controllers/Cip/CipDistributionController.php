<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Distribution;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The CIP Distribution Group (§22).
 *
 * Membership is edited on People → Distribution groups. Extra mailboxes that
 * are not portal accounts are kept here so compliance mail is not env-only.
 */
class CipDistributionController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        abort_unless(CipAccess::canReach($request->user()), 404);

        $group = Distribution::ensure($request->user());
        $group->load(['members.user:id,name,email']);

        $members = $group->members
            ->map(function ($member) {
                $user = $member->user;
                $email = $user?->email;

                if (! $email) {
                    return null;
                }

                return [
                    'name' => $user->name,
                    'email' => $email,
                ];
            })
            ->filter()
            ->values()
            ->all();

        return response()->json([
            'canEdit' => CipAccess::can($request->user(), 'cip.configure'),
            'groupName' => Distribution::groupName(),
            'members' => $members,
            'extraEmails' => Distribution::extraEmails(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);
        abort_unless(CipAccess::can($user, 'cip.configure'), 403, 'Only an administrator can change the distribution list.');

        $data = $request->validate([
            'extraEmails' => ['present', 'array', 'max:50'],
            'extraEmails.*' => ['nullable', 'string', 'max:191'],
        ]);

        $emails = Distribution::putExtraEmails($data['extraEmails'], $user->id);

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'cip.distribution_updated',
            'module' => 'cip',
            'description' => 'CIP distribution extra mailboxes updated',
            'new' => ['extraEmails' => $emails],
        ]);

        return $this->show($request);
    }
}
