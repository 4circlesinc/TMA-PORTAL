<?php

namespace App\Http\Controllers;

use App\Models\CallRecording;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\ClientScope;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Messaging\ClientConversations;
use App\Support\Messaging\MessagingPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Conversations and call recordings that belong on a client record.
 *
 * Staff open these from the Message button on an applicant: either the case
 * thread with the service provider, or a private DM with the person when they
 * have a portal login. The profile tab reads the same list so the file keeps
 * a record of what was said and which calls were captured.
 */
class ClientConversationController extends Controller
{
    public function index(Request $request, string $uid): JsonResponse
    {
        $this->authorizeReach($request);

        $client = $this->clientForActor($request->user(), $uid);
        $payload = ClientConversations::index($client, $request->user());

        return response()->json([
            'options' => $payload['options'],
            'conversations' => $payload['conversations'],
            'recordings' => $this->recordings($request, $client->id),
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        // Not authorizeStaff: the provider side opens this file's case thread
        // too, and ClientConversations::open decides which of them may open
        // what. Reach is still required — ClientScope answers 404 for a file
        // this account cannot see.
        $this->authorizeReach($request);

        $data = $request->validate([
            'with' => ['required', 'string', 'in:provider,person'],
        ]);

        $client = $this->clientForActor($request->user(), $uid);
        $conversation = ClientConversations::open($client, $request->user(), $data['with']);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $request->user()),
        ], 201);
    }

    /**
     * Recordings of calls about this applicant. Anyone who can open the client
     * sees the file's recordings, that is the point of keeping them here —
     * rather than only the calls they personally placed.
     *
     * @return array<int, array<string, mixed>>
     */
    private function recordings(Request $request, int $clientId): array
    {
        return CallRecording::query()
            ->with(['client:id,uid,name', 'conversation:id,uuid'])
            ->where('client_id', $clientId)
            ->orderByDesc('started_at')
            ->limit(50)
            ->get()
            ->map(function (CallRecording $r) {
                $status = $r->status === CallRecording::STATUS_RECORDING && $r->isInterrupted()
                    ? 'interrupted'
                    : $r->status;

                return [
                    'id' => $r->uuid,
                    'clientName' => $r->client_name,
                    'participants' => $r->participants ?: [],
                    'media' => $r->media,
                    'status' => $status,
                    'durationMs' => (int) $r->duration_ms,
                    'startedAt' => $r->started_at?->toIso8601String(),
                    'endedAt' => $r->ended_at?->toIso8601String(),
                    'conversationId' => $r->conversation?->uuid,
                ];
            })
            ->values()
            ->all();
    }

    /**
     * The client this uid names, as far as this account is concerned.
     *
     * Staff resolve through ClientScope, their assignments. The provider side
     * holds no assignment and never will, so they resolve through the CIP
     * application scope instead — the same gate that decides which files they
     * may open at all. Both answer 404 for a record the account cannot see,
     * so neither leaks the existence of the other's clients.
     */
    private function clientForActor(User $user, string $uid): Client
    {
        if (Role::can($user, 'clients.view')) {
            return ClientScope::findOrFail($user, $uid);
        }

        $client = ApplicationScope::query($user)
            ->whereHas('client', fn ($q) => $q->where('uid', $uid))
            ->with('client')
            ->firstOrFail()
            ->client;

        abort_if($client === null, 404);

        return $client;
    }

    /**
     * May this account act on a client file at all?
     *
     * Staff hold the directory capability. Service-provider contacts and
     * private clients hold no capability by design, so they are admitted by
     * CIP reach, exactly as the CIP screens admit them; which files they may
     * touch is still ClientScope's answer, and which thread they may open is
     * ClientConversations::open's.
     */
    private function authorizeReach(Request $request): void
    {
        abort_unless(
            Role::can($request->user(), 'clients.view') || CipAccess::canReach($request->user()),
            403,
            'Only staff can manage the client directory.'
        );
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            Role::can($request->user(), 'clients.view'),
            403,
            'Only staff can manage the client directory.'
        );
    }
}
