<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;
use App\Models\User;
use RuntimeException;

/**
 * Finds a user's mail-enabled connected account and builds the right provider
 * for it. Everything above this point works against {@see MailProvider} and
 * never learns which vendor is on the other end.
 */
class Mailbox
{
    /** Portal folders, in the order the sidebar lists them. */
    public const FOLDERS = ['inbox', 'sent', 'draft', 'spam', 'trash', 'archive'];

    public static function provider(ConnectedAccount $account): MailProvider
    {
        return match ($account->provider) {
            'google' => GmailProvider::for($account),
            'microsoft' => GraphProvider::for($account),
            default => throw new RuntimeException("No mail provider for '{$account->provider}'."),
        };
    }

    /**
     * The account backing this user's mailbox, or null when they have not
     * connected one (or connected it without opting into mail).
     */
    public static function accountFor(User $user): ?ConnectedAccount
    {
        return ConnectedAccount::query()
            ->where('user_id', $user->id)
            ->where('sync_email', true)
            ->whereNotNull('token')
            // A user could connect both; the most recently linked wins.
            ->latest('updated_at')
            ->first();
    }

    /** Same, but fails loudly — for routes that cannot do anything useful without one. */
    public static function requireAccountFor(User $user): ConnectedAccount
    {
        $account = self::accountFor($user);

        if (! $account) {
            throw new MailAuthException(
                'No mailbox is connected. Connect Google or Microsoft to use email.'
            );
        }

        return $account;
    }
}
