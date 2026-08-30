<?php

namespace App\Support\Mail;

use App\Mail\Postcard;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use App\Support\Templates\SystemEmails;
use Illuminate\Support\HtmlString;

/**
 * Every transactional email, one factory method each. The wording lives in
 * App\Support\Templates\SystemEmails — the shipped copy plus whatever an
 * administrator has reworded on the Templates page — and each factory here
 * supplies the dynamic values (links, names, dates) and the structural rows
 * (details, files, a quoted note) the copy is filled with. Method signatures
 * are unchanged from the hard-coded era, so triggers never notice.
 */
class Postcards
{
    private const SITE = 'TM ANTOINE Advisory';

    /**
     * The firm's name as anyone outside it should see it.
     *
     * Not config('app.name'): APP_NAME is unset on Laravel Cloud, where it falls
     * back to "tma-portal", which is what an invited client would otherwise be
     * told the organization is called. The emails have always used this
     * constant, so screens that sit alongside them read it from here too.
     */
    public static function site(): string
    {
        return self::SITE;
    }

    /** Fill one template and wrap it as a ready-to-send Postcard. */
    private static function postcard(string $key, array $vars, array $extras = []): Postcard
    {
        $built = SystemEmails::payload($key, $vars, $extras);

        return new Postcard($built['subject'], $built['payload'], attachment: $extras['attachment'] ?? null);
    }

    /**
     * Fill one template as a payload array for mailables that keep their own
     * envelope; the template's subject rides along under 'subject' and the
     * mailable strips it before the view.
     */
    private static function payloadFor(string $key, array $vars, array $extras = []): array
    {
        $built = SystemEmails::payload($key, $vars, $extras);

        return $built['payload'] + ['subject' => $built['subject']];
    }

    private static function firstName(?string $name): ?string
    {
        return $name ? (strtok($name, ' ') ?: $name) : null;
    }

    // ---------------------------------------------------------- account / auth

    public static function verifyEmail(string $url, ?string $name = null): Postcard
    {
        return self::postcard('verify-email', ['name' => $name, 'url' => $url], ['url' => $url]);
    }

    public static function resetPassword(string $url, ?string $name = null): Postcard
    {
        return self::postcard('reset-password', ['name' => $name, 'url' => $url], ['url' => $url]);
    }

    /** Build the "password changed" email for a user from the current request. */
    public static function passwordChangedFor(User $user): Postcard
    {
        $details = [['When', now()->format('j M Y, g:i A')]];
        if ($device = self::deviceLabel(request()?->userAgent())) {
            $details[] = ['Device', $device];
        }

        return self::passwordChanged($details, url('/security-settings'));
    }

    /** A short, human "Chrome on macOS" from a user-agent string. */
    private static function deviceLabel(?string $ua): ?string
    {
        if (! $ua) {
            return null;
        }

        $os = match (true) {
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS'), str_contains($ua, 'Macintosh') => 'macOS',
            str_contains($ua, 'iPhone'), str_contains($ua, 'iPad') => 'iOS',
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'Linux') => 'Linux',
            default => null,
        };
        $browser = match (true) {
            str_contains($ua, 'Edg') => 'Edge',
            str_contains($ua, 'Chrome') => 'Chrome',
            str_contains($ua, 'Firefox') => 'Firefox',
            str_contains($ua, 'Safari') => 'Safari',
            default => null,
        };

        return trim(($browser ?: '').($browser && $os ? ' on ' : '').($os ?: '')) ?: null;
    }

    /** @param array<int,array{0:string,1:string}> $details When/Device rows. */
    public static function passwordChanged(array $details, string $secureUrl): Postcard
    {
        return self::postcard('password-changed', ['url' => $secureUrl], [
            'details' => $details,
            'url' => $secureUrl,
        ]);
    }

    public static function changeEmail(string $url, string $newEmail): Postcard
    {
        return self::postcard('change-email', ['url' => $url, 'newEmail' => $newEmail], ['url' => $url]);
    }

    /**
     * $note is the optional line a staff member types on People → Resend
     * welcome emails; it rides along as the quote block.
     */
    public static function welcome(string $email, string $portalUrl, ?string $name = null, ?string $note = null): Postcard
    {
        return self::postcard('welcome', [
            'name' => $name,
            'email' => $email,
            'url' => $portalUrl,
        ], ['url' => $portalUrl, 'quote' => $note ?: null]);
    }

    /**
     * Sent the moment a self-registration lands. Without it the person hears
     * nothing at all between signing up and an administrator getting round to
     * them, which reads as a broken signup form.
     */
    public static function accountPending(string $email, ?string $name = null): Postcard
    {
        return self::postcard('account-pending', ['name' => $name, 'email' => $email]);
    }

    /**
     * The other half of {@see self::welcome()}. $reason is the note the
     * administrator typed on the deny dialog; it is shown only when given.
     */
    public static function accountDenied(?string $name = null, ?string $reason = null): Postcard
    {
        return self::postcard('account-denied', ['name' => $name], ['quote' => $reason ?: null]);
    }

    /**
     * An administrator closed somebody's account.
     *
     * A closed account cannot sign in, so the bell notification raised at the
     * same time is one they will never see; this is the only way the decision
     * reaches the person it is about.
     */
    public static function accountDeleted(string $email, ?string $name = null): Postcard
    {
        return self::postcard('account-deleted', ['name' => $name, 'email' => $email]);
    }

    public static function newLogin(array $details, string $reviewUrl): Postcard
    {
        return self::postcard('new-login', ['url' => $reviewUrl], [
            'details' => $details,
            'url' => $reviewUrl,
        ]);
    }

    /**
     * Two-factor authentication was turned on, turned off, or had its recovery
     * codes replaced. $action is the past-tense phrase for the lead line.
     */
    public static function twoFactorChanged(string $title, string $action, string $reviewUrl): Postcard
    {
        $details = [['When', now()->format('j M Y, g:i A')]];
        if ($device = self::deviceLabel(request()?->userAgent())) {
            $details[] = ['Device', $device];
        }

        return self::postcard('two-factor-changed', [
            'title' => $title,
            'action' => $action,
            'url' => $reviewUrl,
        ], ['details' => $details, 'url' => $reviewUrl]);
    }

    /**
     * The optional monthly recap of account activity.
     *
     * @param  array<int,array{0:string,1:string}>  $details  the counted rows
     */
    public static function securitySummary(string $period, array $details, string $reviewUrl, ?string $name = null): Postcard
    {
        return self::postcard('security-summary', [
            'name' => $name,
            'period' => $period,
            'url' => $reviewUrl,
        ], ['details' => $details, 'url' => $reviewUrl]);
    }

    // ---------------------------------------------------------------- signatures
    // These return payload arrays; the mailables read 'subject' for their
    // envelope (the sender's own wording wins on the invitation).

    public static function signatureInvitation(string $title, ?string $sender, ?string $note, string $url, ?string $name, $expiresAt, string $action): array
    {
        return self::payloadFor('signature-invitation', [
            'title' => $title,
            'sender' => $sender,
            'name' => $name,
            'action' => $action,
            'expires' => $expiresAt?->format('j M Y'),
            'url' => $url,
        ], ['url' => $url, 'quote' => $note ?: null]);
    }

    public static function signatureReminder(string $title, ?string $sender, string $url, ?string $name, $expiresAt): array
    {
        return self::payloadFor('signature-reminder', [
            'title' => $title,
            'sender' => $sender,
            'name' => $name,
            'expires' => $expiresAt?->format('j M Y'),
            'url' => $url,
        ], ['url' => $url]);
    }

    /** @param array<int,string> $signers */
    public static function signatureCompleted(string $title, ?string $name, array $signers, bool $attached, string $url): array
    {
        return self::payloadFor('signature-completed', [
            'title' => $title,
            'name' => $name,
            'signers' => $signers ? implode(', ', $signers) : null,
            'attached' => $attached,
            'url' => $url,
        ], ['url' => $url]);
    }

    public static function signatureDeclined(string $title, ?string $reason, ?string $by, string $url): array
    {
        return self::payloadFor('signature-declined', [
            'title' => $title,
            'by' => $by,
            'url' => $url,
        ], ['url' => $url, 'quote' => $reason ?: null]);
    }

    public static function signatureChangesRequested(string $title, ?string $comment, ?string $by, string $url): array
    {
        return self::payloadFor('signature-changes-requested', [
            'title' => $title,
            'by' => $by,
            'url' => $url,
        ], ['url' => $url, 'quote' => $comment ?: null]);
    }

    // ------------------------------------------------------------- client invite

    /**
     * The invitation a client receives when they are added to the portal.
     *
     * @param  bool  $hasAccount  true when the address already has a login, so
     *                            the ask is "sign in and accept", not "sign up"
     */
    public static function clientInvite(
        ?string $name,
        string $url,
        ?string $inviter = null,
        ?\DateTimeInterface $expiresAt = null,
        bool $hasAccount = false,
    ): Postcard {
        return self::postcard($hasAccount ? 'client-invite-existing' : 'client-invite', [
            'name' => $name,
            'inviter' => $inviter,
            'url' => $url,
        ], ['url' => $url, 'details' => self::expiryDetails($expiresAt)]);
    }

    public static function clientInviteReminder(
        ?string $name,
        string $url,
        ?\DateTimeInterface $expiresAt = null,
    ): Postcard {
        return self::postcard('client-invite-reminder', [
            'name' => $name,
            'url' => $url,
        ], ['url' => $url, 'details' => self::expiryDetails($expiresAt)]);
    }

    /** The invitation a new staff member receives. */
    public static function staffInvite(
        ?string $name,
        string $url,
        string $role,
        ?string $inviter = null,
        ?\DateTimeInterface $expiresAt = null,
        ?string $department = null,
        bool $hasAccount = false,
    ): Postcard {
        $details = [['Role', e($role)]];
        if ($department) {
            $details[] = ['Department', e($department)];
        }
        $details = array_merge($details, self::expiryDetails($expiresAt));

        return self::postcard($hasAccount ? 'staff-invite-existing' : 'staff-invite', [
            'name' => $name,
            'inviter' => $inviter,
            'url' => $url,
        ], ['url' => $url, 'details' => $details]);
    }

    /** The invitation someone receives when asked to join a company account. */
    public static function companyMemberInvite(
        ?string $name,
        string $companyName,
        string $url,
        string $companyRole,
        ?string $inviter = null,
        ?\DateTimeInterface $expiresAt = null,
        bool $hasAccount = false,
        bool $isProvider = false,
    ): Postcard {
        return self::postcard($hasAccount ? 'company-member-invite-existing' : 'company-member-invite', [
            'name' => $name,
            'company' => $companyName,
            'role' => $companyRole,
            'inviter' => $inviter,
            'isProvider' => $isProvider,
            'url' => $url,
        ], [
            'url' => $url,
            'details' => array_values(array_filter(array_merge(
                [
                    ['Company', e($companyName)],
                    ['Your role', e($companyRole)],
                    $inviter ? ['Invited by', e($inviter)] : null,
                ],
                self::expiryDetails($expiresAt),
            ))),
        ]);
    }

    /** Told to someone whose existing account was added to a company. */
    public static function companyMemberAdded(
        ?string $name,
        string $companyName,
        string $url,
        string $companyRole,
        ?string $addedBy = null,
        bool $isProvider = false,
    ): Postcard {
        return self::postcard('company-member-added', [
            'name' => $name,
            'company' => $companyName,
            'role' => $companyRole,
            'addedBy' => $addedBy,
            'isProvider' => $isProvider,
            'url' => $url,
        ], [
            'url' => $url,
            'details' => array_values(array_filter([
                ['Company', e($companyName)],
                ['Your role', e($companyRole)],
                $addedBy ? ['Added by', e($addedBy)] : null,
            ])),
        ]);
    }

    /** Told to someone whose company access has just been taken away. */
    public static function companyMemberRemoved(
        ?string $name,
        string $companyName,
        string $url,
        ?string $removedBy = null,
        bool $isProvider = false,
    ): Postcard {
        return self::postcard('company-member-removed', [
            'name' => $name,
            'company' => $companyName,
            'removedBy' => $removedBy,
            'isProvider' => $isProvider,
            'url' => $url,
        ], [
            'url' => $url,
            'details' => array_values(array_filter([
                ['Company', e($companyName)],
                $removedBy ? ['Removed by', e($removedBy)] : null,
            ])),
        ]);
    }

    /** Told to a staff member when they are assigned to a client. */
    public static function staffAssignedToClient(
        string $staffName,
        string $clientName,
        string $roleLabel,
        ?string $assigner,
        string $url,
        bool $isPrimary = false,
    ): Postcard {
        return self::postcard('staff-assigned-to-client', [
            'name' => $staffName,
            'client' => $clientName,
            'assigner' => $assigner,
            'url' => $url,
        ], [
            'url' => $url,
            'details' => array_values(array_filter([
                ['Client', e($clientName)],
                ['Your role', e($roleLabel)],
                $isPrimary ? ['Primary contact', 'Yes'] : null,
            ])),
        ]);
    }

    /** Told to a client when a staff member becomes their contact. */
    public static function clientStaffAssigned(
        ?string $clientName,
        string $staffName,
        ?string $staffTitle,
        string $url,
    ): Postcard {
        return self::postcard('client-staff-assigned', [
            'name' => $clientName,
            'staff' => $staffName,
            'url' => $url,
        ], [
            'url' => $url,
            'details' => array_values(array_filter([
                ['Contact', e($staffName)],
                $staffTitle ? ['Role', e($staffTitle)] : null,
            ])),
        ]);
    }

    /** Told to the inviter once someone accepts. */
    public static function invitationAccepted(
        string $recipientName,
        string $whoAccepted,
        string $whatFor,
        string $url,
    ): Postcard {
        return self::postcard('invitation-accepted', [
            'name' => $recipientName,
            'who' => $whoAccepted,
            'whatFor' => $whatFor,
            'url' => $url,
        ], ['url' => $url]);
    }

    /** The "expires on" row shared by every invitation email. */
    private static function expiryDetails(?\DateTimeInterface $expiresAt): array
    {
        return $expiresAt
            ? [['Expires', $expiresAt->format('j M Y, g:i A')]]
            : [];
    }

    // --------------------------------------------------------------------- files

    public static function fileShared(string $sharer, string $itemName, bool $isFolder, string $url, ?string $note = null): Postcard
    {
        return self::postcard('file-shared', [
            'sharer' => $sharer,
            'item' => $itemName,
            'what' => $isFolder ? 'a folder' : 'a file',
            'kind' => $isFolder ? 'folder' : 'document',
            'url' => $url,
        ], [
            'url' => $url,
            'files' => [[$itemName, $isFolder ? 'Folder' : 'File']],
            'quote' => $note ?: null,
        ]);
    }

    /**
     * "Please upload these documents", the invitation to a secure upload link.
     *
     * @param  array<int, array{0: string, 1: string}>  $details  label/value rows
     */
    public static function fileRequest(
        string $title,
        string $requester,
        ?string $message,
        string $url,
        ?string $name = null,
        array $details = [],
    ): Postcard {
        return self::postcard('file-request', [
            'title' => $title,
            'requester' => $requester,
            'name' => $name,
            'url' => $url,
        ], ['url' => $url, 'quote' => $message ?: null, 'details' => $details]);
    }

    /** The requester's copy: something arrived through one of their links. */
    public static function fileRequestReceived(
        string $title,
        int $count,
        ?string $from,
        string $url,
        ?string $name = null,
    ): Postcard {
        return self::postcard('file-request-received', [
            'title' => $title,
            'what' => $count === 1 ? 'A file' : $count.' files',
            'whatLower' => $count === 1 ? 'a file' : $count.' files',
            'from' => $from,
            'name' => $name,
            'url' => $url,
        ], ['url' => $url]);
    }

    // ----------------------------------------------------------- message reminders

    /** $tier: 1 (~1h), 2 (~20h), 3 (~24h, final). */
    public static function messageReminder(int $tier, string $from, ?string $preview, string $url): Postcard
    {
        $key = match ($tier) {
            2 => 'message-reminder-2',
            3 => 'message-reminder-3',
            default => 'message-reminder-1',
        };

        return self::postcard($key, ['from' => $from, 'url' => $url], [
            'url' => $url,
            'quote' => $preview ?: null,
        ]);
    }

    // --------------------------------------------------------------------- teams

    public static function teamAdded(string $addedBy, string $groupName, string $url): Postcard
    {
        return self::postcard('team-added', [
            'addedBy' => $addedBy,
            'team' => $groupName,
            'url' => $url,
        ], ['url' => $url]);
    }

    // ------------------------------------------------------------------ calendar

    /** @param array<string,mixed> $p the EventNotifier payload. */
    public static function calendar(string $kind, array $p): array
    {
        $details = [];
        if (! empty($p['whenLabel'])) {
            $details[] = ['When', e($p['whenLabel'])];
        }
        if (! empty($p['location'])) {
            $details[] = ['Where', e($p['location'])];
        }
        if (! empty($p['organizer'])) {
            $details[] = ['Organizer', e($p['organizer'])];
        }

        $key = match ($kind) {
            'updated' => 'calendar-updated',
            'cancelled' => 'calendar-cancelled',
            'response' => 'calendar-response',
            default => 'calendar-invitation',
        };

        return self::payloadFor($key, [
            'title' => $p['title'] ?? 'Event',
            'name' => $p['name'] ?? null,
            'organizer' => $p['organizer'] ?? null,
            'attendee' => $p['attendee'] ?? 'Someone',
            'response' => $p['responseLabel'] ?? 'responded',
            'changes' => ! empty($p['changes']) ? implode(', ', $p['changes']) : null,
            'url' => $p['url'] ?? null,
        ], [
            'details' => $details,
            // Raw: the postcard template escapes `quote` itself.
            'quote' => ! empty($p['description']) ? $p['description'] : null,
            'url' => $p['url'] ?? '',
        ]);
    }

    // ------------------------------------------------------------------- cip

    /** The CIP greeting variable: the addressee's first name. */
    private static function cipVars(array $facts, ?string $recipientName): array
    {
        return [
            'number' => $facts['number'],
            'applicant' => $facts['applicant'],
            'provider' => $facts['provider'],
            'recipient' => self::firstName($recipientName),
        ];
    }

    /**
     * §10's assignment notice: the file has been handed to this officer.
     *
     * The subject is §22's compliance format, not prose, because these emails
     * are filed, and a mailbox full of them is sorted and searched by exactly
     * those fields. It stays with the caller and is not editable copy.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int, statusLabel:string, roleLabel:string}  $facts
     */
    public static function cipAssigned(array $facts, ?User $officer, string $url, ?string $subject = null, ?string $recipientName = null): Postcard
    {
        $subject ??= Notices::line($facts, Status::REVIEW_APPLICATION, $officer);

        return self::postcard('cip-assigned', self::cipVars($facts, $recipientName ?: $officer?->name) + [
            'status' => $facts['statusLabel'],
            'url' => $url,
        ], [
            'subject' => $subject,
            'url' => $url,
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
                ['Status', $facts['statusLabel']],
                ['Family size', 'F'.$facts['familySize']],
            ],
        ]);
    }

    /**
     * §14's notice to the provider side: documents have been sent back.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     * @param  list<array{label:string, reason:?string}>  $sentBack
     */
    public static function cipUpdatesRequired(array $facts, array $sentBack, ?User $actor, string $url, ?string $recipientName = null, ?string $subject = null): Postcard
    {
        $subject ??= Notices::line($facts, Status::UPDATE_REQUIRED, $actor);

        $list = collect($sentBack)->map(fn (array $doc) => '<li><strong>'.e($doc['label']).'</strong>'
            .($doc['reason'] ? ', '.e($doc['reason']) : '')
            .'</li>')->implode('');

        $count = count($sentBack);

        return self::postcard('cip-updates-required', self::cipVars($facts, $recipientName) + [
            'docsNeed' => $count.' document'.($count === 1 ? '' : 's').' need'.($count === 1 ? 's' : ''),
            'sent' => $count === 1 ? 'one back' : $count.' back',
            'documents' => new HtmlString('<ul>'.$list.'</ul>'),
            'url' => $url,
        ], [
            'subject' => $subject,
            'url' => $url,
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
            ],
        ]);
    }

    /**
     * §15's notice to the provider side: the file is ready, confirm it.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    public static function cipReadyToSubmit(array $facts, string $url, ?string $recipientName = null, ?string $subject = null): Postcard
    {
        $subject ??= Notices::line($facts, Status::READY_TO_SUBMIT);

        return self::postcard('cip-ready-to-submit', self::cipVars($facts, $recipientName) + ['url' => $url], [
            'subject' => $subject,
            'url' => $url,
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
            ],
        ]);
    }

    /**
     * §18's notice to the provider side: the Unit has asked for more.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    public static function cipNonCompliant(
        array $facts,
        string $url,
        ?string $queryReceivedAt = null,
        ?string $recipientName = null,
        ?User $actor = null,
        ?string $subject = null,
    ): Postcard {
        $subject ??= Notices::line($facts, Status::NON_COMPLIANT, $actor);

        $details = [
            ['Application', $facts['number']],
            ['Applicant', $facts['applicant']],
            ['Service provider', $facts['provider']],
        ];
        if ($queryReceivedAt) {
            $details[] = ['Query received', $queryReceivedAt];
        }

        return self::postcard('cip-non-compliant', self::cipVars($facts, $recipientName) + ['url' => $url], [
            'subject' => $subject,
            'url' => $url,
            'details' => $details,
        ]);
    }

    /**
     * §20's notice: 180 days after acceptance, still no decision.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    public static function cipDelayed(
        array $facts,
        string $url,
        ?string $acceptedAt = null,
        int $days = 180,
        ?string $recipientName = null,
        ?string $subject = null,
    ): Postcard {
        $subject ??= Notices::line($facts, Status::DELAYED);

        $details = [
            ['Application', $facts['number']],
            ['Applicant', $facts['applicant']],
            ['Service provider', $facts['provider']],
        ];
        if ($acceptedAt) {
            $details[] = ['Accepted for processing', $acceptedAt];
        }

        return self::postcard('cip-delayed', self::cipVars($facts, $recipientName) + [
            'days' => (string) $days,
            'url' => $url,
        ], [
            'subject' => $subject,
            'url' => $url,
            'details' => $details,
        ]);
    }

    /**
     * §21 / §23: the Unit decided. Subject stays §22's filing format.
     * Title and body come from the investment-type letter when one is given.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     * @param  array{title:string, lead:string, bodyHtml:?string}|null  $copy
     */
    public static function cipDecision(
        array $facts,
        string $url,
        string $decision,
        ?string $decidedAt = null,
        ?string $recipientName = null,
        ?User $actor = null,
        ?string $subject = null,
        ?array $copy = null,
        ?FileItem $attachment = null,
    ): Postcard {
        $subject ??= Notices::line($facts, $decision, $actor);
        $granted = $decision === Status::GRANTED;
        $label = Status::label($decision);

        $details = [
            ['Application', $facts['number']],
            ['Applicant', $facts['applicant']],
            ['Service provider', $facts['provider']],
            ['Decision', $label],
        ];
        if ($decidedAt) {
            $details[] = ['Decision date', $decidedAt];
        }

        // array_merge, not +: cipVars already carries a 'recipient' and the
        // union would keep its null over the full name the letter addresses.
        return self::postcard('cip-decision', array_merge(self::cipVars($facts, null), [
            'recipient' => $recipientName,
            'decision' => $label,
            'decisionLower' => strtolower($label),
            'letterTitle' => $copy['title'] ?? ($facts['number'].' was '.strtolower($label)),
            'letterLead' => $copy['lead'] ?? ($granted
                ? 'The Unit has granted '.$facts['applicant'].'’s application.'
                : 'The Unit has denied '.$facts['applicant'].'’s application.'),
            'letterBody' => ! empty($copy['bodyHtml']) ? new HtmlString($copy['bodyHtml']) : null,
            'url' => $url,
        ]), [
            'subject' => $subject,
            'url' => $url,
            'details' => $details,
            'attachment' => $attachment,
        ]);
    }

    /**
     * A §22 status notice whose body is the move itself. New Application,
     * Assessment Feedback, Pending Review, Background Check.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    public static function cipStatus(array $facts, string $status, string $url, ?string $recipientName = null, ?string $subject = null): Postcard
    {
        $subject ??= Notices::line($facts, $status);
        $label = Status::label($status);

        // Each §22 stage is its own template on the Templates page; DRAFT
        // still files as NEW, and anything unmapped keeps the shared one.
        $key = 'cip-status-'.str_replace('_', '-', $status === Status::DRAFT ? Status::NEW : $status);
        if (! in_array($key, SystemEmails::keys(), true)) {
            $key = 'cip-status';
        }

        return self::postcard($key, self::cipVars($facts, $recipientName) + [
            'status' => $label,
            'url' => $url,
        ], [
            'subject' => $subject,
            'url' => $url,
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
                ['Status', $label],
                ['Family size', 'F'.$facts['familySize']],
            ],
        ]);
    }

    /**
     * The email twin of a portal notification, for accounts that switched the
     * email channel on for that module. Kept deliberately spare: the subject
     * and body ARE the notification; the button deep-links to whatever the
     * bell entry would open.
     */
    public static function notification(string $title, ?string $message, ?string $actionUrl, ?string $actionLabel, ?string $name, string $module): Postcard
    {
        $url = $actionUrl
            ? (str_starts_with($actionUrl, 'http') ? $actionUrl : rtrim(config('app.url'), '/').$actionUrl)
            : null;

        return self::postcard('notification', [
            'title' => $title,
            'message' => $message,
            'name' => $name,
            'module' => ucfirst($module ?: 'notification'),
            'actionLabel' => $actionLabel ?: 'Open the portal',
        ], ['url' => $url ?: '']);
    }
}
