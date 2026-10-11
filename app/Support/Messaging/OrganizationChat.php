<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The firm-wide default conversation.
 *
 * One group staff are in, owned by the firm rather than by whoever created
 * it: administrators manage it, nobody on staff leaves it, and membership
 * follows the staff list instead of being curated. Clients and other
 * outside accounts stay out.
 *
 * Both the chat and its membership are reconciled lazily, when a user loads
 * their conversations — rather than by a console command and a hook on account
 * approval. A command has to be remembered on every new database, and until
 * somebody does the firm has no group at all. A hook would be one more thing
 * to call from every path that creates or approves an account, and it would
 * leave everyone who joined before this feature existed permanently outside
 * the chat. Reconciling on read is self-healing.
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
            /*
             * The Dashboard and the Messages page ask at the same moment, so
             * two requests can both find nothing and both create one. The
             * lock is held to the end of the transaction: the second waits,
             * then finds the first one's chat instead of making its own.
             */
            if (DB::connection()->getDriverName() === 'pgsql') {
                DB::select('SELECT pg_advisory_xact_lock(?)', [self::advisoryKey()]);

                $existing = Conversation::where('is_default', true)->first();

                if ($existing) {
                    return $existing;
                }
            }

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
     * Bring every auto-join conversation in line with the staff list.
     *
     * The firm chat is internal: administrators and officers. Everyone who
     * works here is put in at once, not as each of them happens to open
     * Messages: a colleague who has not looked yet would otherwise get no
     * word of what was said there, and the group would count only the people
     * who had. Anyone who is not staff is taken out.
     *
     * Runs on each conversation-list load, whoever is asking: the answer is
     * the same for all of them. Two statements a chat when there is nothing
     * to do, which is the normal case.
     */
    public static function syncMembership(): void
    {
        $conversations = Conversation::query()
            ->where('auto_join', true)
            ->whereNull('disabled_at')
            ->get();

        if ($conversations->isEmpty()) {
            $chat = self::ensure();

            // One that was switched off, or made invitation-only, stays so.
            if (! $chat->auto_join || $chat->isDisabled()) {
                return;
            }

            $conversations = collect([$chat]);
        }

        foreach ($conversations as $conversation) {
            self::pruneOutsiders($conversation);
            self::admitStaff($conversation);
        }
    }

    /**
     * Everyone who works here and can open the portal.
     *
     * Role::STAFF also carries the parked Employee type. Those accounts are
     * held on the role-pending screen until an administrator gives them a
     * working role, so they could not open the chat, and would only be sent
     * reminders about messages they cannot read. They join the moment they
     * are given one.
     */
    private static function staff(): Builder
    {
        return User::query()
            ->where('status', User::STATUS_APPROVED)
            ->whereIn('account_type', [Role::ADMINISTRATOR, ...Role::OFFICERS]);
    }

    /**
     * Put in every member of staff who is not already there.
     *
     * Administrators are given the admin role so the chat is always
     * manageable; the pin makes it sit at the top of the list, which is what
     * "pinned by default" means for a firm-wide channel.
     */
    private static function admitStaff(Conversation $conversation): void
    {
        $missing = self::staff()
            ->whereNotIn(
                'id',
                ConversationParticipant::query()
                    ->select('user_id')
                    ->where('conversation_id', $conversation->id)
                    ->whereNull('left_at')
            )
            ->get(['id', 'account_type']);

        if ($missing->isEmpty()) {
            return;
        }

        // Someone who was in before keeps their row, and with it how far
        // they had read.
        $returning = $conversation->participants()
            ->whereIn('user_id', $missing->pluck('id'))
            ->get()
            ->keyBy('user_id');

        foreach ($missing as $member) {
            $role = Role::isAdmin($member)
                ? ConversationParticipant::ROLE_ADMIN
                : ConversationParticipant::ROLE_MEMBER;

            if ($participant = $returning->get($member->id)) {
                $participant->forceFill([
                    'left_at' => null,
                    'joined_at' => now(),
                    'role' => $role,
                ])->save();

                continue;
            }

            // Another request may be admitting the same person right now;
            // the table allows one row each, so the second finds the first's.
            $conversation->participants()->createOrFirst(
                ['user_id' => $member->id],
                ['role' => $role, 'joined_at' => now(), 'pinned_at' => now()],
            );
        }
    }

    /** Drop anyone who does not work here from a firm-wide chat. */
    private static function pruneOutsiders(Conversation $conversation): void
    {
        ConversationParticipant::query()
            ->where('conversation_id', $conversation->id)
            ->whereNull('left_at')
            ->whereNotIn('user_id', self::staff()->select('id'))
            ->update(['left_at' => now()]);
    }

    private static function advisoryKey(): int
    {
        $unsigned = crc32('tma-org-chat');

        return $unsigned > 0x7FFFFFFF ? $unsigned - 0x100000000 : $unsigned;
    }
}
