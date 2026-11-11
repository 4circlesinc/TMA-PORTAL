<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Files\PublicUploadController;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Models\UserBlock;
use App\Support\Messaging\ChatFileRequests;
use App\Support\Messaging\MessagingPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Request files from a chat ("/" then Request files), and answer one.
 *
 * Asking: which applications may be asked about here, then the request
 * itself, which posts the card in the chat. Answering: an upload against
 * one requested document from the card. That goes through the very code the
 * emailed upload link runs, so a file sent from a chat is renamed, filed and
 * versioned exactly as one sent from the link, and the link's token never
 * has to reach the page.
 *
 * Every route resolves the conversation through the caller's own
 * participation, so a stranger gets a 404, as in MessagingController.
 */
class MessagingFileRequestController extends Controller
{
    /** Where this chat's request can point: the case's application, or a choice. */
    public function options(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($user, $uuid);

        if (! ChatFileRequests::canRequest($user)) {
            return response()->json(['canRequest' => false, 'fixed' => null, 'applications' => []]);
        }

        $fixed = ChatFileRequests::fixedApplication($conversation, $user);

        return response()->json([
            'canRequest' => true,
            'fixed' => $fixed ? ChatFileRequests::presentApplication($fixed) : null,
            'applications' => $fixed ? [] : ChatFileRequests::applications($conversation, $user, $request->query('q'))
                ->map(fn ($application) => ChatFileRequests::presentApplication($application))
                ->values(),
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($user, $uuid);
        $this->assertNotBlocked($conversation, $user);

        $data = $request->validate([
            'application' => ['nullable', 'string', 'max:64'],
            'documents' => ['nullable', 'array', 'max:60'],
            'documents.*' => ['string', 'max:64'],
            'folder' => ['nullable', 'string', 'max:64'],
            'title' => ['nullable', 'string', 'max:150'],
            'message' => ['nullable', 'string', 'max:2000'],
            'expiresAt' => ['nullable', 'date', 'after:today'],
        ]);

        $message = ChatFileRequests::create($conversation, $user, $data);

        return response()->json([
            'message' => MessagingPresenter::message($message, $user, $conversation),
        ], 201);
    }

    /**
     * One file for one requested document (or for a folder request).
     *
     * Anyone in the chat may answer; the upload is checked, renamed and filed
     * by PublicUploadController against the request's own rules, which is
     * also where every chat showing the request is told it changed.
     */
    public function upload(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();

        $message = Message::query()
            ->whereHas('conversation', fn ($q) => $q->forUser($user))
            ->where('uuid', $uuid)
            ->where('type', Message::TYPE_FILE_REQUEST)
            ->with('conversation.activeParticipants.user')
            ->firstOrFail();

        abort_if($message->hiddenFrom($user), 404);
        $this->assertNotBlocked($message->conversation, $user);

        $fileRequest = $message->fileRequest;
        abort_unless($fileRequest, 410, 'This request is no longer open.');

        // Who sent it is the person signed in, not whatever the form says.
        $request->merge(['name' => $user->name, 'email' => $user->email]);

        $response = app(PublicUploadController::class)->upload($request, (string) $fileRequest->token);

        return response()->json([
            'fileRequest' => ChatFileRequests::present($fileRequest->fresh()),
            'upload' => $response->getData(true),
        ], $response->status());
    }

    private function conversationFor(User $user, string $uuid): Conversation
    {
        return Conversation::query()
            ->forUser($user)
            ->with('activeParticipants.user')
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    private function assertNotBlocked(Conversation $conversation, User $user): void
    {
        if ($conversation->isGroup()) {
            return;
        }

        $other = $conversation->counterpartFor($user);

        if ($other && UserBlock::blockedBetween($user->id, $other->id)) {
            abort(403, 'This conversation is unavailable.');
        }
    }
}
