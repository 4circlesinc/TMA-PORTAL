<?php

namespace App\Support\Companies;

use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\Contacts;
use Illuminate\Support\Facades\Log;

/**
 * The one mailbox a firm's email notifications go to.
 *
 * Everyone on a firm's Access list hears about its work twice, the bell in
 * the portal and an email. A firm may ask for the email to reach one of them
 * only: that person is chosen on the Access card, and from then on the others
 * keep their access and the bell and are not emailed. Nobody chosen is
 * everyone, which is how every firm stood before this.
 *
 * It is about notifications, the email that says something happened. What a
 * person needs in order to get in or to act is theirs whatever the firm
 * chose: sign-in codes, password and security mail, invitations, a change to
 * their own access, a document to sign or to approve.
 *
 * A notice written to one person (a file shared with them, a reminder of a
 * message they have not read) is not passed on to the chosen mailbox: it
 * would put one person's conversation in front of another. They have the
 * bell.
 *
 * Every reader fails toward sending. A chosen member who has since left, a
 * row that has gone, a query that throws: each of those is everyone again,
 * never silence. Leaving ends the choice for good ({@see forget()}), so
 * coming back later does not quietly narrow the firm's mail again.
 */
final class NotificationEmail
{
    /**
     * The member this firm's notification emails go to, or null for everyone.
     *
     * Only while they are still on its Access list and have an address. A
     * member with an invitation they have not taken up counts: a firm's
     * shared mailbox may never sign in and can still be where the mail goes.
     */
    public static function memberFor(?Company $company, bool $fresh = false): ?CompanyMember
    {
        if ($company === null) {
            return null;
        }

        try {
            // `$fresh` for a caller that has just changed the firm's list:
            // the choice may have ended since this company was loaded.
            $attributes = $fresh ? [] : $company->getAttributes();

            if (array_key_exists('notification_member_id', $attributes)) {
                $id = $company->notification_member_id;
            } elseif (array_key_exists('created_at', $attributes)) {
                // The whole row and no choice on it: a company made in this
                // request, or a database the column has not reached yet.
                // Asking for it there would be a failed query, and on
                // Postgres that ends whatever transaction it is asked in.
                $id = null;
            } else {
                // Loaded for its name alone. That says nothing either way,
                // and reading it as "nobody chosen" would email everyone.
                $id = Company::query()->withTrashed()->whereKey($company->getKey())->value('notification_member_id');
            }

            if ($id === null) {
                return null;
            }

            $member = CompanyMember::query()->with('user')->find($id);
        } catch (\Throwable $e) {
            Log::warning('NotificationEmail.memberFor failed', ['error' => $e->getMessage()]);

            return null;
        }

        if ($member === null
            || (int) $member->company_id !== (int) $company->id
            || $member->isRemoved()
            || self::addressOf($member) === null) {
            return null;
        }

        return $member;
    }

    /**
     * Where a member's notices are written to. The row's own address first,
     * the way {@see Contacts::providerContacts} has always
     * read it, so choosing someone never moves their mail to another mailbox.
     */
    public static function addressOf(CompanyMember $member): ?string
    {
        $email = trim((string) ($member->email ?: $member->user?->email));

        return $email === '' ? null : $email;
    }

    /** Choose the member, or pass null to go back to everyone. */
    public static function choose(Company $company, ?CompanyMember $member, User $by): void
    {
        $was = self::memberFor($company);

        // Quietly: this is a preference of the firm's, not an edit to its
        // record, and the directory caches a save would flush hold none of it.
        $company->forceFill(['notification_member_id' => $member?->id])->saveQuietly();

        if ($was?->id === $member?->id) {
            return;
        }

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'company.notification_email_changed',
            'module' => 'clients',
            'description' => $member
                ? $by->name.' set '.$company->name.'’s email notifications to go to '.self::addressOf($member).' only'
                : $by->name.' set '.$company->name.'’s email notifications to go to everyone with access',
            'subject' => $company,
            'old' => ['email' => $was ? self::addressOf($was) : null],
            'new' => ['email' => $member ? self::addressOf($member) : null],
        ]);
    }

    /**
     * End the choice if it was this member: they have left the firm's list,
     * or come back to it.
     *
     * A removed member keeps their row, and adding them again revives it, so
     * a choice left standing would return with them, months later, with
     * nobody having made it. Called from the member's own model events, so
     * every way of leaving ends it alike.
     */
    public static function forget(CompanyMember $member): void
    {
        try {
            $cleared = Company::query()->withTrashed()
                ->whereKey($member->company_id)
                ->where('notification_member_id', $member->id)
                ->update(['notification_member_id' => null]);

            if (! $cleared) {
                return;
            }

            $company = Company::query()->withTrashed()->find($member->company_id);

            ActivityLogger::log([
                'actor' => auth()->user(),
                'type' => 'company.notification_email_changed',
                'module' => 'clients',
                'description' => ($company?->name ?? 'A company').'’s email notifications went back to everyone with access',
                'subject' => $company,
                'old' => ['email' => self::addressOf($member)],
                'new' => ['email' => null],
            ]);
        } catch (\Throwable $e) {
            Log::warning('NotificationEmail.forget failed', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Should a notification email go to this person at all?
     *
     * For the sends that know the person and not the firm. Staff are never a
     * firm's contacts. Somebody at two firms is emailed unless both of them
     * chose somebody else, because there is no telling which firm a message
     * or a comment was about.
     */
    public static function wanted(?User $user): bool
    {
        if ($user === null || Role::isStaff($user)) {
            return true;
        }

        try {
            // Whole rows on purpose: naming the column would be a failed
            // query on a database it has not reached ({@see memberFor()}).
            $companies = Company::query()
                ->whereIn('id', CompanyMember::active()->where('user_id', $user->id)->select('company_id'))
                ->get();

            if ($companies->isEmpty()) {
                return true;
            }

            foreach ($companies as $company) {
                $chosen = self::memberFor($company);

                if ($chosen === null || self::is($chosen, $user)) {
                    return true;
                }
            }

            return false;
        } catch (\Throwable $e) {
            Log::warning('NotificationEmail.wanted failed', ['error' => $e->getMessage()]);

            return true;
        }
    }

    /**
     * Add one recipient to a list keyed by mailbox, where the same mailbox
     * may arrive from more than one class of recipient.
     *
     * The later row wins, as it always has. A mailbox is left without its
     * email only when every class that names it says so: a firm's choice
     * quiets its own contacts, never a copy somebody else is owed.
     *
     * @param  array<string, array<string, mixed>>  $recipients
     * @param  array<string, mixed>  $recipient
     */
    public static function fold(array &$recipients, array $recipient): void
    {
        $key = mb_strtolower((string) $recipient['email']);

        $quiet = self::quiet($recipient)
            && (! isset($recipients[$key]) || self::quiet($recipients[$key]));

        $recipients[$key] = $recipient;

        if ($quiet) {
            $recipients[$key]['mail'] = false;
        } else {
            unset($recipients[$key]['mail']);
        }
    }

    /**
     * Leave every mailbox on a firm's list but the chosen one without its
     * email. They stay on the list: the bell and the live refresh read it too.
     *
     * @param  array<string, array<string, mixed>>  $recipients  keyed by lowercased mailbox
     * @return array<string, array<string, mixed>>
     */
    public static function only(array $recipients, string $chosenKey): array
    {
        foreach ($recipients as $key => $recipient) {
            if ((string) $key !== $chosenKey) {
                $recipients[$key]['mail'] = false;
            }
        }

        return $recipients;
    }

    /**
     * Does this recipient go without the email? Only a row that says so.
     *
     * @param  array<string, mixed>  $recipient
     */
    public static function quiet(array $recipient): bool
    {
        return ($recipient['mail'] ?? true) === false;
    }

    private static function is(CompanyMember $chosen, User $user): bool
    {
        if ($chosen->user_id !== null && (int) $chosen->user_id === (int) $user->id) {
            return true;
        }

        $mine = mb_strtolower(trim((string) $user->email));

        return $mine !== '' && $mine === mb_strtolower((string) self::addressOf($chosen));
    }
}
