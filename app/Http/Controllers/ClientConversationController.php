<?php

namespace App\Http\Controllers;

use App\Models\CallRecording;
use App\Support\Access\ClientScope;
use App\Support\Access\Role;
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
        $this->authorizeStaff($request);

        $client = ClientScope::findOrFail($request->user(), $uid);
        $payload = ClientConversations::index($client, $request->user());

        return response()->json([
            'options' => $payload['options'],
            'conversations' => $payload['conversations'],
            'recordings' => $this->recordings($request, $client->id),
        ]);
    }

    public function store(Request $request, string $uid): JsonResponse
    {
        $this->authorizeStaff($request);

        $data = $request->validate([
            'with' => ['required', 'string', 'in:provider,person'],
        ]);

        $client = ClientScope::findOrFail($request->user(), $uid);
        $conversation = ClientConversations::open($client, $request->user(), $data['with']);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $request->user()),
        ], 201);
    }

    /**
     * Recordings of calls about this applicant. Anyone who can open the client
     * sees the file's recordings — that is the point of keeping them here —
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

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            Role::can($request->user(), 'clients.view'),
            403,
            'Only staff can manage the client directory.'
        );
    }
}
