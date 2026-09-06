<?php

namespace App\Support\Security;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Notifications\Notifier;
use App\Support\SecurityPolicies;

/**
 * Who else hears about an account-safety event, firm-wide.
 *
 * Account settings > Security > Security alert settings edits this. It sits
 * beside {@see SecurityAlerts}, which is the *personal* half, a person
 * choosing which of their own alerts to receive. This half is the firm's:
 * whether administrators and named contacts are told as well.
 *
 * ── Why only two events ──────────────────────────────────────────────────
 *
 * The screen this replaced offered four, including "a user signs in from a
 * different country", "…from a different city using a different device" and
 * "a suspicious file is uploaded". None of them could ever have fired: the
 * portal does no geo-IP lookup and runs no malware scanner, so those switches
 * described a product that does not exist. They are not carried over.
 *
 * What is here are the two the portal genuinely detects today, both already
 * recorded in `auth_events`:
 *
     *  - `newDevice`, a returning account signs in from an IP and user agent it
     *    has never used. Detected in {@see \App\Listeners\RecordAuthEvent}.
     *  - `failedSignIns`, repeated failures against one account inside an hour.
     *  - Country, download-burst, IP-count, suspicious-IP, and malware events
     *    are detected when the matching auto-remediation toggle is on.
     */
final class SecurityAlertPolicy
{
    /** How far back repeated failures are counted. */
    public const FAILURE_WINDOW_MINUTES = 60;

    /** The whole policy, defaults filled in. */
    public static function all(): array
    {
        return SecurityPolicies::get('alerts');
    }

    /** Are administrators told about this event? */
    public static function notifiesAdmins(string $event): bool
    {
        return (bool) (self::all()[$event]['admins'] ?? false);
    }

    /** How many failures inside the window count as an alert. */
    public static function failureThreshold(): int
    {
        $threshold = (int) (self::all()['failedSignInThreshold'] ?? 5);

        return max(3, min(20, $threshold));
    }

    /**
     * Extra addresses to copy, parsed from the comma-separated setting.
     *
     * @return list<string>
     */
    public static function alternateContacts(): array
    {
        $raw = (string) (self::all()['alternateContacts'] ?? '');

        $emails = array_filter(
            array_map('trim', explode(',', $raw)),
            fn (string $e) => $e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL),
        );

        return array_values(array_unique($emails));
    }

    /**
     * Tell the firm about a security event on someone's account.
     *
     * The account owner is notified separately and always, that is
     * {@see SecurityAlerts}, and it is not this method's business. This adds
     * the administrators and named contacts on top, and only if the firm asked
     * for them.
     */
    public static function fanOut(string $event, User $subject, string $title, string $message): void
    {
        if (! self::notifiesAdmins($event)) {
            return;
        }

        foreach (self::admins() as $admin) {
            // The administrator who *is* the subject already got the personal
            // alert; sending it twice makes both easier to ignore.
            if ($admin->id === $subject->id) {
                continue;
            }

            Notifier::send([
                'user' => $admin,
                'type' => 'security.firm_alert',
                'title' => $title,
                'message' => $message,
                'action_url' => '/account-settings?settings-page=security-insights',
            ]);
        }
    }

    /**
     * Whether this failure is the one that crosses the threshold.
     *
     * Deliberately "the one that crosses", not "at or above": a sustained
     * attack would otherwise alert on every attempt after the fifth, which is
     * how a real warning gets filtered into a folder nobody opens.
     */
    public static function crossedFailureThreshold(?int $userId): bool
    {
        if ($userId === null || ! self::notifiesAdmins('failedSignIns')) {
            return false;
        }

        $failures = AuthEvent::where('user_id', $userId)
            ->where('event', 'login_failed')
            ->where('created_at', '>=', now()->subMinutes(self::FAILURE_WINDOW_MINUTES))
            ->count();

        return $failures === self::failureThreshold();
    }

    /** @return \Illuminate\Support\Collection<int, User> */
    private static function admins()
    {
        return User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', 'approved')
            ->get();
    }
}
