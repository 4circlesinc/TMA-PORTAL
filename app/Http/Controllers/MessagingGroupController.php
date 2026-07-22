<?php

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\Vault;
use App\Support\Messaging\MessagingPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * Group conversations: creating them, and changing who and what they are.
 *
 * Split from MessagingController because group administration is a different
 * concern from sending and reading — different permissions, and every change
 * leaves a system message in the thread so the group can see its own history.
 *
 * Membership is still the authorization boundary: every route resolves through
 * `Conversation::forUser()`, so a non-member gets a 404 before permissions are
 * even considered.
 */
class MessagingGroupController extends Controller
{
    /** A group may not grow unbounded through this endpoint. */
    private const MAX_MEMBERS = 256;

    // -------------------------------------------------------------- create

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'memberIds' => ['required', 'array', 'min:1', 'max:'.self::MAX_MEMBERS],
            'memberIds.*' => ['integer', 'exists:users,id'],
        ]);

        $members = User::query()
            ->whereIn('id', $data['memberIds'])
            ->where('id', '!=', $user->id)
            ->where('status', User::STATUS_APPROVED)
            ->get();

        if ($members->isEmpty()) {
            throw ValidationException::withMessages([
                'memberIds' => 'Choose at least one other person for the group.',
            ]);
        }

        $conversation = DB::transaction(function () use ($user, $members, $data) {
            $conversation = Conversation::create([
                'type' => Conversation::TYPE_GROUP,
                'name' => trim($data['name']),
                'description' => $data['description'] ?? null,
                'created_by' => $user->id,
                'last_message_at' => now(),
            ]);

            // The creator runs the group they made.
            $conversation->participants()->create([
                'user_id' => $user->id,
                'role' => ConversationParticipant::ROLE_ADMIN,
                'joined_at' => now(),
            ]);

            foreach ($members as $member) {
                $conversation->participants()->create([
                    'user_id' => $member->id,
                    'role' => ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);
            }

            $this->systemMessage($conversation, 'group_created', ['actorName' => $user->name]);

            return $conversation;
        });

        $conversation->load(['activeParticipants.user', 'messages' => fn ($q) => $q->latest('id')->limit(1)]);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $user),
        ], 201);
    }

    // ---------------------------------------------------------- name/photo

    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->groupFor($request, $uuid);

        $this->assertManages($conversation, $user);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        if (array_key_exists('name', $data)) {
            $name = trim($data['name']);

            if ($name === '') {
                throw ValidationException::withMessages(['name' => 'A group needs a name.']);
            }

            // Only announce a real change; saving the same name is not news.
            if ($name !== $conversation->name) {
                $conversation->name = $name;
                $this->systemMessage($conversation, 'name_changed', [
                    'actorName' => $user->name,
                    'name' => $name,
                ]);
            }
        }

        if (array_key_exists('description', $data)) {
            $conversation->description = $data['description'];
        }

        $conversation->save();

        return $this->groupResponse($conversation, $user);
    }

    public function updatePhoto(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->groupFor($request, $uuid);

        $this->assertManages($conversation, $user);

        $request->validate(['photo' => ['required', 'file', 'max:10240']]);

        $file = $request->file('photo');
        $absolute = $file->getRealPath();

        // Sniffs the bytes, so a renamed script cannot become a group photo.
        $inspected = FileType::inspect($absolute, $file->getClientOriginalName());

        if (! str_starts_with((string) ($inspected['mime'] ?? ''), 'image/')) {
            throw ValidationException::withMessages(['photo' => 'Choose an image file.']);
        }

        $previousDisk = $conversation->photo_disk;
        $previousPath = $conversation->photo_path;

        $stored = Vault::store($absolute, $inspected['extension'] ?? '');

        $conversation->forceFill([
            'photo_disk' => $stored['disk'],
            'photo_path' => $stored['path'],
        ])->save();

        // Drop the old bytes only once the new ones are safely stored.
        if ($previousPath) {
            try {
                Storage::disk($previousDisk ?: $stored['disk'])->delete($previousPath);
            } catch (\Throwable $e) {
                // A leftover file is untidy, not broken.
            }
        }

        $this->systemMessage($conversation, 'photo_changed', ['actorName' => $user->name]);

        return $this->groupResponse($conversation, $user);
    }

    // ------------------------------------------------------------- members

    public function addMembers(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->groupFor($request, $uuid);

        $this->assertManages($conversation, $user);

        $data = $request->validate([
            'memberIds' => ['required', 'array', 'min:1'],
            'memberIds.*' => ['integer', 'exists:users,id'],
        ]);

        if ($conversation->activeParticipants()->count() + count($data['memberIds']) > self::MAX_MEMBERS) {
            throw ValidationException::withMessages([
                'memberIds' => 'That would take the group past '.self::MAX_MEMBERS.' people.',
            ]);
        }

        $added = [];

        foreach (User::whereIn('id', $data['memberIds'])->where('status', User::STATUS_APPROVED)->get() as $member) {
            $existing = $conversation->participants()->where('user_id', $member->id)->first();

            if ($existing && $existing->left_at === null) {
                continue;   // already here
            }

            if ($existing) {
                // Rejoining keeps the original row, so their past messages
                // still resolve to a member of this conversation.
                $existing->forceFill(['left_at' => null, 'joined_at' => now()])->save();
            } else {
                $conversation->participants()->create([
                    'user_id' => $member->id,
                    'role' => ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);
            }

            $added[] = $member->name;
            $this->systemMessage($conversation, 'member_added', [
                'actorName' => $user->name,
                'subjectName' => $member->name,
            ]);
        }

        if ($added === []) {
            throw ValidationException::withMessages([
                'memberIds' => 'Those people are already in the group.',
            ]);
        }

        return $this->groupResponse($conversation, $user);
    }

    public function removeMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->groupFor($request, $uuid);

        $this->assertManages($conversation, $user);

        $participant = $conversation->activeParticipants()->where('user_id', $userId)->first();
        abort_if($participant === null, 404, 'That person is not in this group.');

        // Removing the last administrator would leave the group unmanageable.
        $this->assertNotLastAdmin($conversation, $participant);

        $participant->forceFill(['left_at' => now()])->save();

        $this->systemMessage($conversation, 'member_removed', [
            'actorName' => $user->name,
            'subjectName' => $participant->user?->name ?? 'Someone',
        ]);

        return $this->groupResponse($conversation, $user);
    }

    /** Promote to administrator, or demote back to member. */
    public function updateMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->groupFor($request, $uuid);

        $this->assertManages($conversation, $user);

        $data = $request->validate([
            'role' => ['required', 'in:member,admin'],
        ]);

        $participant = $conversation->activeParticipants()->where('user_id', $userId)->first();
        abort_if($participant === null, 404, 'That person is not in this group.');

        if ($participant->role === $data['role']) {
            return $this->groupResponse($conversation, $user);
        }

        if ($data['role'] === ConversationParticipant::ROLE_MEMBER) {
            $this->assertNotLastAdmin($conversation, $participant);
        }

        $participant->forceFill(['role' => $data['role']])->save();

        $this->systemMessage(
            $conversation,
            $data['role'] === ConversationParticipant::ROLE_ADMIN ? 'admin_granted' : 'admin_revoked',
            ['actorName' => $user->name, 'subjectName' => $participant->user?->name ?? 'Someone']
        );

        return $this->groupResponse($conversation, $user);
    }

    // ------------------------------------------------------------- helpers

    /** A group this user belongs to, or a 404. */
    private function groupFor(Request $request, string $uuid): Conversation
    {
        $conversation = Conversation::query()
            ->forUser($request->user())
            ->with('activeParticipants.user')
            ->where('uuid', $uuid)
            ->firstOrFail();

        abort_unless($conversation->isGroup(), 422, 'That conversation is not a group.');

        return $conversation;
    }

    private function assertManages(Conversation $conversation, User $user): void
    {
        abort_unless(
            $conversation->isManageableBy($user),
            403,
            $conversation->is_default
                ? 'Only administrators can change the organization chat.'
                : 'Only group administrators can change this group.'
        );
    }

    /**
     * A group must keep at least one administrator.
     *
     * Without this a group can be left with nobody able to add members, rename
     * it, or remove anyone — recoverable only from the database.
     */
    private function assertNotLastAdmin(Conversation $conversation, ConversationParticipant $participant): void
    {
        if (! $participant->isAdmin()) {
            return;
        }

        $admins = $conversation->activeParticipants()
            ->where('role', ConversationParticipant::ROLE_ADMIN)
            ->count();

        abort_if(
            $admins <= 1,
            422,
            'This is the group’s only administrator. Promote someone else first.'
        );
    }

    /**
     * Record a change in the thread itself.
     *
     * Detail goes in `system_event` rather than a rendered sentence, so the
     * client phrases it and a future rename of the wording does not have to
     * rewrite history.
     */
    private function systemMessage(Conversation $conversation, string $event, array $detail = []): void
    {
        $message = $conversation->messages()->create([
            'user_id' => null,
            'type' => Message::TYPE_SYSTEM,
            'system_event' => array_merge(['event' => $event], $detail),
        ]);

        $conversation->forceFill(['last_message_at' => $message->created_at])->save();
    }

    private function groupResponse(Conversation $conversation, User $user): JsonResponse
    {
        $fresh = $conversation->fresh([
            'activeParticipants.user',
            'messages' => fn ($q) => $q->latest('id')->limit(1),
        ]);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($fresh, $user),
        ]);
    }
}
