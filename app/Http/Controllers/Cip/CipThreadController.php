<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Threads;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The application messaging centre (§24).
 *
 * 404 rather than 403 for a file the reader may not see. Internal notes are
 * dropped in the read query for anyone who is not staff — they never leave
 * the server in a payload the provider side could inspect.
 */
class CipThreadController extends Controller
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);
        $peek = (bool) $request->boolean('peek');

        if (! $peek) {
            Threads::markRead($application, $user);
        }

        return response()->json([
            'canPostInternal' => Threads::canPostInternal($user),
            'lanes' => Threads::lanesFor($user),
            'messages' => Threads::listed($application, $user),
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.Threads::MAX_LENGTH],
            'lane' => ['nullable', 'string', 'max:16'],
        ]);

        $message = Threads::create(
            $application,
            $user,
            $data['body'],
            (string) ($data['lane'] ?? ''),
        );

        return response()->json(Threads::present($message->fresh()->load(['author', 'companyMember']), $user), 201);
    }
}
