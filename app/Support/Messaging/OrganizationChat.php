<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Support\Facades\DB;

/**
 * The firm-wide default conversation.
 *
 * One group staff are in, owned by the firm rather than by whoever created
 * it: administrators manage it, nobody on staff leaves it, and membership
 * follows the staff list instead of being curated. Clients and other
 * outside accounts stay out.
 *
 * Membership is reconciled lazily, when a user loads their conversations —
 * rather than by a hook on account approval. A hook would be one more thing to
 * remember to call from every path that creates or approves an account, and it
 * would leave everyone who joined before this feature existed permanently
 * outside the chat. Reconciling on read is self-healing.
 */
class OrganizationChat
{
    public const NAME = 'TM Antoine Advisory and Partners';

    public const DESCRIPTION = 'Firm-wide announcements and general discussion.';

    /** The org chat, if one has been created. */
    public static function current(): ?Conversation
    {
        return Conversation::query()
            ->where('is_default', true)
            ->whereNull('disabled_at')
            ->first();
    }

    /** Create it if absent, and return it either way. */
    public static function ensure(?User $creator = null): Conversation
    {
        $existing = Conversation::where('is_default', true)->first();

        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($creator) {
            $conversation = Conversation::create([
                'type' => Conversation::TYPE_GROUP,
                'name' => self::NAME,
                'description' => self::DESCRIPTION,
                'is_default' => true,
                'auto_join' => true,
                'created_by' => $creator?->id,
                'last_message_at' => now(),
            ]);

            $conversation->messages()->create([
                'user_id' => null,
                'type' => Message::TYPE_SYSTEM,
                'system_event' => [
                    'event' => 'group_created',
                    'actorName' => $creator?->name ?? 'The portal',
                ],
            ]);

            return $conversation;
        });
    }

    /**
     * Make sure this user is in every auto-join conversation, or out of it.
     *
     * The firm chat is internal: administrators, employees, and officers.
     * A service-provider contact opening Messages used to be folded in
     * because this ran for every account, and the comment about following
     * the staff list was never actually checked.
     *
     * Cheap enough to call on each conversation-list load: one indexed lookup
     * when there is nothing to do, which is the normal case.
     *
     * Administrators are given the admin role so the chat is always
     * manageable; the pin makes it sit at the top of the list, which is what
     * "pinned by default" means for a firm-wide channel.
     */
    public static function syncMembership(User $user): void
    {
        $conversations = Conversation::query()
            ->where('auto_join', true)
            ->whereNull('disabled_at')
            ->get();

        foreach ($conversations as $conversation) {
            self::pruneOutsiders($conversation);

            if (! Role::isStaff($user)) {
                continue;
            }

            $participant = $conversation->participants()
                ->where('user_id', $user->id)
                ->first();

            if ($participant && $participant->left_at === null) {
                continue;
            }

            $role = Role::isAdmin($user)
                ? ConversationParticipant::ROLE_ADMIN
                : ConversationParticipant::ROLE_MEMBER;

            if ($participant) {
                $participant->forceFill([
                    'left_at' => null,
                    'joined_at' => now(),
                    'role' => $role,
                ])->save();

                continue;
            }

            $conversation->participants()->create([
                'user_id' => $user->id,
                'role' => $role,
                'joined_at' => now(),
                'pinned_at' => now(),
            ]);
        }
    }

    /** Drop anyone who does not work here from a firm-wide chat. */
    private static function pruneOutsiders(Conversation $conversation): void
    {
        ConversationParticipant::query()
            ->where('conversation_id', $conversation->id)
            ->whereNull('left_at')
            ->whereIn(
                'user_id',
                User::query()->select('id')->whereNotIn('account_type', Role::STAFF)
            )
            ->update(['left_at' => now()]);
    }
}
