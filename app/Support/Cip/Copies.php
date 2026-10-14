<?php

namespace App\Support\Cip;

use App\Models\User;
use App\Support\Access\Role;

/**
 * The copy a staff member gets of a notice written to the service provider.
 *
 * Section 22 sends every notice to four classes at once, and three of them
 * are the firm's own people: administrators hear about every application,
 * an officer about the files they hold, the distribution group about
 * whatever the firm put it on. The provider side is the addressee; the rest
 * are copies, and a copy is the one part of the list a person may decline.
 * Settings › Service Provider Emails carries one switch per kind of notice,
 * and this is their one reader.
 *
 * A kind is the status the notice announces, so the page reads like the
 * status chips on the applications table, plus the document comment, which
 * moves no status. Nothing is stored until somebody flips a switch: what an
 * untouched switch answers follows the account, on for the employees and
 * off for administrators, who are copied on every application the firm has.
 *
 * The bell is not a copy. Somebody who has turned their copies off still
 * sees the change in the portal; what stops is the email.
 */
final class Copies
{
    /**
     * The all-or-nothing switch the page grew out of, on users.preferences.
     *
     * Still honoured: a person who turned it off before the page existed
     * keeps every copy off, and setting it through /me/preferences is how
     * the page's own "all" switch says everything at once.
     */
    public const PREFERENCE = 'notifyProviderCopies';

    /** The per-kind choices, a sparse map of kind => bool. */
    public const KINDS_PREFERENCE = 'cipCopies';

    /** The kind for a comment on a checklist document. */
    public const COMMENT = 'comment';

    /**
     * Every kind the page offers, in the order it lists them.
     *
     * Status::DRAFT is absent because a draft is never announced. The
     * settings page keeps the same ids in public/js/settings.js
     * (PROVIDER_EMAIL_GROUPS), and CipProviderCopiesTest holds the two
     * together.
     */
    public const KINDS = [
        Status::NEW,
        Status::REVIEW_APPLICATION,
        Status::ASSESSMENT_FEEDBACK,
        Status::UPDATE_REQUIRED,
        Status::READY_TO_SUBMIT,
        Status::PENDING_REVIEW,
        Status::NON_COMPLIANT,
        Status::BACKGROUND_CHECK,
        Status::DD_QUERY,
        Status::DELAYED,
        Status::GRANTED,
        Status::DENIED,
        Status::POST_APPROVAL,
        Status::APPLY_FOR_COR,
        Status::PENDING_COR,
        Status::APPLY_FOR_NIC,
        Status::PENDING_NIC,
        Status::APPLY_FOR_PASSPORT,
        Status::PENDING_PASSPORT,
        Status::READY_FOR_DELIVERY,
        Status::POST_APPROVED,
        Status::POST_DENIED,
        Status::CLOSED,
        Status::NEW_APPEAL,
        Status::APPEAL_READY,
        Status::APPEAL_SUBMITTED,
        self::COMMENT,
    ];

    /**
     * What a switch nobody has touched answers for this account.
     *
     * Employees are copied on the files they hold and want to hear of them;
     * administrators are copied on every application, so theirs start off.
     */
    public static function defaultFor(User $user): bool
    {
        return ! Role::isAdmin($user);
    }

    /**
     * Every kind with what it answers for this account, in page order.
     *
     * @return array<string, bool>
     */
    public static function forUser(User $user): array
    {
        $out = [];
        foreach (self::KINDS as $kind) {
            $out[$kind] = self::resolve($user, $kind);
        }

        return $out;
    }

    /**
     * Does this mailbox want the email copy of this kind of notice?
     *
     * A mailbox with no account, and a provider-side account, is being
     * written to rather than copied, so the switches do not apply to them:
     * a firm's contact cannot silence the notices the firm is owed.
     */
    public static function wanted(?User $user, string $kind): bool
    {
        if ($user === null || ! Role::isStaff($user)) {
            return true;
        }

        return self::resolve($user, $kind);
    }

    /**
     * Fold a write from /me/preferences into a preferences array.
     *
     * `$all` is the page's "all" switch (and the old single switch): it
     * says everything at once, so the per-kind choices made before it are
     * forgotten. `$kinds` then sets single switches, a null forgetting that
     * switch's choice so it follows the account again. Unknown kinds are
     * dropped so a stale client cannot write junk into the column.
     *
     * @param  array<string, mixed>  $prefs
     * @param  array<string, mixed>|null  $kinds
     * @return array<string, mixed>
     */
    public static function write(array $prefs, ?bool $all, ?array $kinds): array
    {
        if ($all !== null) {
            $prefs[self::PREFERENCE] = $all;
            unset($prefs[self::KINDS_PREFERENCE]);
        }

        if ($kinds !== null) {
            $stored = is_array($prefs[self::KINDS_PREFERENCE] ?? null) ? $prefs[self::KINDS_PREFERENCE] : [];
            foreach ($kinds as $kind => $value) {
                if (! in_array($kind, self::KINDS, true)) {
                    continue;
                }
                if ($value === null) {
                    unset($stored[$kind]);

                    continue;
                }
                $stored[$kind] = (bool) $value;
            }

            if ($stored === []) {
                unset($prefs[self::KINDS_PREFERENCE]);
            } else {
                $prefs[self::KINDS_PREFERENCE] = $stored;
            }
        }

        return $prefs;
    }

    /**
     * A switch's own choice first, then the old single switch, then the
     * account's default. A kind added after somebody chose follows the old
     * switch, or the account, until they choose for it too.
     */
    private static function resolve(User $user, string $kind): bool
    {
        $prefs = is_array($user->preferences) ? $user->preferences : [];

        $stored = $prefs[self::KINDS_PREFERENCE] ?? null;
        if (is_array($stored) && is_bool($stored[$kind] ?? null)) {
            return $stored[$kind];
        }

        $all = $prefs[self::PREFERENCE] ?? null;
        if (is_bool($all)) {
            return $all;
        }

        return self::defaultFor($user);
    }
}
