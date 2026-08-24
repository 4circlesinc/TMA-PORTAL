<?php

namespace App\Support\Access;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Access\Role;

/**
 * Who a person is allowed to start a conversation with.
 *
 * Messaging used to offer every approved account in the portal to everybody,
 * which meant a client could search up, and message, another client, plus
 * every employee they had never worked with. Staff keep the full directory;
 * a client sees only the people actually working on their account.
 *
 * This governs *discovery*. An existing conversation is still resolved through
 * participation, so nothing here removes a thread somebody is already in.
 */
class ContactScope
{
    /**
     * User ids this person may start a conversation with, or null meaning
     * "no restriction", the caller then skips the whereIn entirely rather
     * than building a list of every user in the portal.
     */
    public static function visibleUserIds(User $user): ?array
    {
        if (Role::can($user, 'messaging.contactAll')) {
            return null;
        }

        $clientIds = Client::query()
            ->where('user_id', $user->id)
            ->orWhere(function ($q) use ($user) {
                // Invited clients are matched on email until the invite links
                // the account, so a brand-new client still reaches their team.
                $q->whereNull('user_id')->whereRaw('lower(email) = ?', [mb_strtolower($user->email)]);
            })
            ->pluck('id');

        $staffIds = ClientAssignment::query()
            ->whereIn('client_id', $clientIds)
            ->pluck('user_id')
            ->all();

        // Administrators are always reachable. Without this a client with no
        // assignments yet would open Messages and find nobody at all, which is
        // a worse failure than the over-sharing this replaces.
        $adminIds = User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->pluck('id')
            ->all();

        return array_values(array_unique([...$staffIds, ...$adminIds]));
    }
}
