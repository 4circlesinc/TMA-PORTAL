<?php

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\ScheduledMessage;
use App\Support\Messaging\ScheduledMessages;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * Announcements a group's admins have written for later.
 *
 * Like every messaging route, the conversation is resolved through
 * `Conversation::forUser()` first, so a non-member gets a 404 before
 * permissions are considered. Scheduling is the admins' alone: it is how an
 * announcement is timed, and an announcement is theirs to make.
 */
class MessagingScheduleController extends Controller
{
    /** What is waiting in this group, for the people who could have written it. */
    public function index(Request $request, string $uuid): JsonResponse
    {
        $conversation = $this->conversationFor($request, $uuid);

        if (! $conversation->isManageableBy($request->user())) {
            return response()->json(['scheduled' => []]);
        }

        $scheduled = ScheduledMessage::query()
            ->with('author')
            ->where('conversation_id', $conversation->id)
            ->whereNull('sent_at')
            ->where(fn ($q) => $q
                ->whereNull('failed_at')
                ->orWhere('failed_at', '>=', now()->subDays(ScheduledMessages::FAILED_SHOWN_DAYS)))
            ->orderBy('send_at')
            ->get();

        return response()->json([
            'scheduled' => $scheduled->map(fn (ScheduledMessage $s) => ScheduledMessages::present($s))->values(),
        ]);
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);

        abort_unless($conversation->isManageableBy($user), 403, 'Only a group admin can post an announcement.');
        abort_if($conversation->isDisabled(), 403, 'This conversation is closed.');

        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
            'sendAt' => ['required', 'date'],
        ]);

        $body = trim($data['body']);
        $sendAt = Carbon::parse($data['sendAt'])->utc();

        if ($body === '') {
            throw ValidationException::withMessages(['body' => 'An announcement needs some text.']);
        }

        if ($sendAt->lte(now())) {
            throw ValidationException::withMessages(['sendAt' => 'Choose a time that has not passed.']);
        }

        if ($sendAt->gt(now()->addDays(ScheduledMessages::MAX_DAYS_AHEAD))) {
            throw ValidationException::withMessages(['sendAt' => 'Choose a time within the next year.']);
        }

        $waiting = ScheduledMessage::query()->waiting()->where('conversation_id', $conversation->id)->count();

        if ($waiting >= ScheduledMessages::MAX_WAITING) {
            throw ValidationException::withMessages(['sendAt' => 'This group already has too many announcements waiting.']);
        }

        $scheduled = ScheduledMessage::create([
            'conversation_id' => $conversation->id,
            'user_id' => $user->id,
            'body' => $body,
            'is_announcement' => true,
            'send_at' => $sendAt,
        ]);

        return response()->json(['scheduled' => ScheduledMessages::present($scheduled->load('author'))], 201);
    }

    /** Withdraw one that has not gone out, or clear one that could not. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();

        $scheduled = ScheduledMessage::query()
            ->where('uuid', $uuid)
            ->whereNull('sent_at')
            ->whereIn('conversation_id', Conversation::query()->forUser($user)->select('id'))
            ->firstOrFail();

        $conversation = Conversation::query()->with('activeParticipants.user')->findOrFail($scheduled->conversation_id);

        abort_unless(
            $scheduled->user_id === $user->id || $conversation->isManageableBy($user),
            403,
            'Only a group admin can withdraw this.',
        );

        $scheduled->delete();

        return response()->json(['ok' => true]);
    }

    private function conversationFor(Request $request, string $uuid): Conversation
    {
        $conversation = Conversation::query()
            ->forUser($request->user())
            ->with('activeParticipants.user')
            ->where('uuid', $uuid)
            ->firstOrFail();

        abort_unless($conversation->isGroup(), 422, 'That conversation is not a group.');

        return $conversation;
    }
}
