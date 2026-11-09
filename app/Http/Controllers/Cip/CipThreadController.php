<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplicationMessage;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Threads;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * The application messaging centre (section 24).
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
            'replyTo' => ['nullable', 'uuid'],
            // One per press of Send. A slow connection that delivers the
            // same press twice, or a second click while the first is still
            // on its way, files one message, not two.
            'clientKey' => ['nullable', 'string', 'max:64'],
        ]);

        $sent = $this->alreadySent($application->id, $user->id, $data);
        if ($sent !== null) {
            return response()->json(Threads::present($sent->fresh()->load(['author', 'companyMember', 'replyTo']), $user), 200);
        }

        $claim = null;
        if (! empty($data['clientKey'])) {
            $claim = 'cip-thread-send:'.$user->id.':'.$application->id.':'.sha1($data['clientKey']);
            // The same press still on its way: say so rather than file it twice.
            abort_unless(Cache::add($claim.':pending', 1, 60), 409, 'This message is already being sent.');
        }

        try {
            $message = Threads::create(
                $application,
                $user,
                $data['body'],
                (string) ($data['lane'] ?? ''),
                $data['replyTo'] ?? null,
            );
        } finally {
            if ($claim !== null) {
                Cache::forget($claim.':pending');
            }
        }

        if ($claim !== null) {
            Cache::put($claim, $message->id, now()->addMinutes(10));
        }

        try {
            $presented = Threads::present($message->fresh()->load(['author', 'companyMember', 'replyTo']), $user);
        } catch (\Throwable $e) {
            // Filed either way; the page reloads the thread rather than
            // reading a send that worked as one that failed.
            report($e);

            return response()->json(['id' => $message->uuid, 'body' => $message->body, 'lane' => $message->lane, 'reload' => true], 201);
        }

        return response()->json($presented, 201);
    }

    /**
     * The message this send already filed, if it is a repeat.
     *
     * By its key when the page sent one. Otherwise by what it says: the same
     * words from the same person on the same lane of the same file inside a
     * few seconds are one press delivered twice, not a second thought.
     *
     * @param  array<string, mixed>  $data
     */
    private function alreadySent(int $applicationId, int $userId, array $data): ?CipApplicationMessage
    {
        if (! empty($data['clientKey'])) {
            $id = Cache::get('cip-thread-send:'.$userId.':'.$applicationId.':'.sha1($data['clientKey']));
            if ($id !== null) {
                return CipApplicationMessage::query()->whereKey($id)->first();
            }
        }

        return CipApplicationMessage::query()
            ->where('application_id', $applicationId)
            ->where('author_id', $userId)
            ->where('body', trim((string) $data['body']))
            ->when(! empty($data['lane']), fn ($query) => $query->where('lane', $data['lane']))
            ->where('created_at', '>=', now()->subSeconds(self::REPEAT_WINDOW_SECONDS))
            ->latest('id')
            ->first();
    }

    /** Identical words inside this window are one press delivered twice. */
    private const REPEAT_WINDOW_SECONDS = 10;

    /** Delete one line: the author's own, or anyone's for an administrator. */
    public function destroy(Request $request, string $uuid, string $message): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);
        $row = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->where('uuid', $message)
            ->firstOrFail();

        Threads::remove($application, $row, $user);

        return response()->json(['deleted' => true, 'id' => $message]);
    }

    public function share(Request $request, string $uuid, string $message): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);
        abort_unless(Threads::canPostInternal($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);
        $row = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->where('uuid', $message)
            ->firstOrFail();

        $shared = Threads::shareWithProvider($application, $row, $user);

        return response()->json(Threads::present($shared->fresh()->load(['author', 'companyMember', 'replyTo']), $user));
    }

    public function react(Request $request, string $uuid, string $message): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);
        $row = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->where('uuid', $message)
            ->firstOrFail();

        $data = $request->validate([
            'emoji' => ['required', 'string', 'max:32'],
        ]);

        return response()->json([
            'id' => $row->uuid,
            'reactions' => Threads::react($application, $row, $user, $data['emoji']),
        ]);
    }

    public function update(Request $request, string $uuid, string $message): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $application = ApplicationScope::findOrFail($user, $uuid);
        $row = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->where('uuid', $message)
            ->firstOrFail();

        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.Threads::MAX_LENGTH],
        ]);

        $updated = Threads::revise($application, $row, $user, $data['body']);

        return response()->json(Threads::present(
            $updated->fresh()->load(['author', 'companyMember', 'replyTo']),
            $user,
        ));
    }
}
