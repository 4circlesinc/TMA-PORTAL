<?php

namespace App\Support\Mail;

use App\Mail\Postcard;
use App\Models\User;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;

/**
 * The copy for every transactional email, one factory method each. Each returns
 * a ready-to-send App\Mail\Postcard; dynamic values (links, names, codes) are
 * arguments. Keeping the wording here, rather than scattered across triggers —
 * keeps the sent emails matching the approved /design/mail gallery.
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

    // ---------------------------------------------------------- account / auth

    public static function verifyEmail(string $url, ?string $name = null): Postcard
    {
        return new Postcard('Confirm your email address', [
            'preheader' => 'One tap confirms your email and finishes setting up your account.',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => 'Confirm your email address',
            'lead' => 'Thanks for creating an account with '.self::SITE.'.',
            'bodyHtml' => '<p>Confirm this is your email address and we\'ll finish setting things up.</p>',
            'button' => ['label' => 'Confirm email address', 'url' => $url],
        ]);
    }

    public static function resetPassword(string $url, ?string $name = null): Postcard
    {
        return new Postcard('Reset your password', [
            'preheader' => 'Use the button below to choose a new password.',
            'eyebrow' => 'Security',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => 'Reset your password',
            'lead' => 'We received a request to reset your password.',
            'bodyHtml' => '<p>Choose a new password using the button below. This link expires in 60 minutes and can only be used once.</p>'
                .'<p>If you didn\'t ask to reset your password, you can safely ignore this email, your current password still works.</p>',
            'button' => ['label' => 'Choose a new password', 'url' => $url],
        ]);
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
        return new Postcard('Your password was changed', [
            'preheader' => 'Confirming your account password was just changed.',
            'eyebrow' => 'Security',
            'title' => 'Your password was changed',
            'lead' => 'This confirms the password on your account was just changed.',
            'details' => $details,
            'quote' => 'Didn\'t make this change? Reset your password immediately and contact us, someone else may have access to your account.',
            'button' => ['label' => 'Secure my account', 'url' => $secureUrl],
        ]);
    }

    public static function changeEmail(string $url, string $newEmail): Postcard
    {
        return new Postcard('Confirm your new email address', [
            'preheader' => 'Confirm the new email address for your account.',
            'title' => 'Confirm your new email address',
            'lead' => 'You asked to change the email on your account.',
            'bodyHtml' => '<p>Confirm <strong>'.e($newEmail).'</strong> to start using it. This link expires in 60 minutes; until you confirm, your account keeps using its current email.</p>',
            'button' => ['label' => 'Confirm new email', 'url' => $url],
        ]);
    }

    /**
     * $note is the optional line a staff member types on People → Resend
     * welcome emails; it rides along as the quote block.
     */
    public static function welcome(string $email, string $portalUrl, ?string $name = null, ?string $note = null): Postcard
    {
        return new Postcard('Your account is ready', array_filter([
            'preheader' => 'Your account has been approved, here\'s how to get started.',
            'eyebrow' => 'Welcome',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'Your account is approved and ready',
            'bodyHtml' => '<p>An administrator has approved your account. You now have access to your files, messages, calendar and everything the firm shares with you.</p>'
                .'<p>Here\'s your sign-in address in case you forget: <a href="'.e($portalUrl).'" style="color:#03a5e9;text-decoration:none;">'.e($email).'</a></p>'
                .'<p>If you need any help getting started, reach out at <a href="mailto:support@tmantoine.com" style="color:#03a5e9;text-decoration:none;">support@tmantoine.com</a>.</p>',
            'quote' => $note,
            'button' => ['label' => 'Open the portal', 'url' => $portalUrl],
        ]));
    }

    /**
     * Sent the moment a self-registration lands. Without it the person hears
     * nothing at all between signing up and an administrator getting round to
     * them, which reads as a broken signup form.
     */
    public static function accountPending(string $email, ?string $name = null): Postcard
    {
        return new Postcard('We\'ve received your request for access', [
            'preheader' => 'Your account request is with our team for review.',
            'eyebrow' => 'Account request',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'We\'ve received your request',
            'lead' => 'Thanks for signing up to '.self::SITE.'.',
            'bodyHtml' => '<p>Your account for <strong>'.e($email).'</strong> has been created and is now waiting for an administrator to review it. You won\'t be able to sign in until it\'s approved.</p>'
                .'<p>We\'ll email you as soon as a decision has been made, there\'s nothing else you need to do.</p>',
        ]);
    }

    /**
     * The other half of {@see self::welcome()}. $reason is the note the
     * administrator typed on the deny dialog; it is shown only when given.
     */
    public static function accountDenied(?string $name = null, ?string $reason = null): Postcard
    {
        return new Postcard('An update on your access request', array_filter([
            'preheader' => 'A decision has been made on your account request.',
            'eyebrow' => 'Account request',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'We couldn\'t approve your request',
            'bodyHtml' => '<p>Your request for access to the '.self::SITE.' portal has been reviewed and we\'re not able to approve it at this time.</p>'
                .'<p>If you think this is a mistake, or you\'d like to know more, reply to this email or contact us at <a href="mailto:support@tmantoine.com" style="color:#03a5e9;text-decoration:none;">support@tmantoine.com</a>.</p>',
            'quote' => $reason,
        ]));
    }

    /**
     * An administrator closed somebody's account.
     *
     * A closed account cannot sign in, so the bell notification raised at the
     * same time is one they will never see; this is the only way the decision
     * reaches the person it is about. Nothing here mentions the Recycle Bin —
     * that the row is recoverable is the firm's business, not a promise to
     * make to somebody who has just lost their access.
     */
    public static function accountDeleted(string $email, ?string $name = null): Postcard
    {
        return new Postcard('Your account has been closed', [
            'preheader' => 'Your access to the portal has been closed.',
            'eyebrow' => 'Account',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'Your account has been closed',
            'bodyHtml' => '<p>An administrator has closed the '.self::SITE.' account for <strong>'.e($email).'</strong>. You will no longer be able to sign in, and the files, messages and calendars shared with you are no longer available.</p>'
                .'<p>If this is unexpected, or you need anything you had stored there, reply to this email or contact us at <a href="mailto:support@tmantoine.com" style="color:#03a5e9;text-decoration:none;">support@tmantoine.com</a>.</p>',
        ]);
    }

    public static function newLogin(array $details, string $reviewUrl): Postcard
    {
        return new Postcard('New sign-in to your account', [
            'preheader' => 'A new device just signed in to your account.',
            'eyebrow' => 'Security',
            'title' => 'New sign-in to your account',
            'lead' => 'We noticed a sign-in from a device we don\'t recognise.',
            'details' => $details,
            'quote' => 'Don\'t recognise this? Secure your account now, we recommend changing your password and reviewing your active sessions.',
            'button' => ['label' => 'Review activity', 'url' => $reviewUrl],
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

        return new Postcard($title, [
            'preheader' => 'A two-factor authentication setting on your account just changed.',
            'eyebrow' => 'Security',
            'title' => $title,
            'lead' => 'Someone '.$action.' two-factor authentication on your account.',
            'details' => $details,
            'quote' => 'Didn\'t make this change? Change your password immediately and review your active sessions, someone else may have access to your account.',
            'button' => ['label' => 'Review security settings', 'url' => $reviewUrl],
        ]);
    }

    /**
     * The optional monthly recap of account activity.
     *
     * @param  array<int,array{0:string,1:string}>  $details  the counted rows
     */
    public static function securitySummary(string $period, array $details, string $reviewUrl, ?string $name = null): Postcard
    {
        return new Postcard('Your security summary for '.$period, [
            'preheader' => 'A short recap of account activity in '.$period.'.',
            'eyebrow' => 'Security',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => 'Your security summary',
            'lead' => 'Here\'s what happened on your account in '.$period.'.',
            'details' => $details,
            'bodyHtml' => '<p>Nothing here needs your attention unless something looks unfamiliar. You can turn this summary off under Account settings → Security.</p>',
            'button' => ['label' => 'Review security settings', 'url' => $reviewUrl],
        ]);
    }

    // ---------------------------------------------------------------- signatures
    // These return payload arrays (the mailables keep their own subject lines).

    public static function signatureInvitation(string $title, ?string $sender, ?string $note, string $url, ?string $name, $expiresAt, string $action): array
    {
        $body = '<p>You can '.$action.' <strong>'.e($title).'</strong> online, no account needed.</p>';
        if ($expiresAt) {
            $body .= '<p>This link is personal to you and expires on '.e($expiresAt->format('j M Y')).'.</p>';
        }

        return [
            'preheader' => $sender ? $sender.' asked you to '.$action.' a document.' : 'A document needs your signature.',
            'eyebrow' => 'Signature',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => $sender ? "{$sender} asked you to {$action} a document" : 'A document needs your signature',
            'bodyHtml' => $body,
            'quote' => $note ?: null,
            'button' => ['label' => 'Review & '.$action, 'url' => $url],
        ];
    }

    public static function signatureReminder(string $title, ?string $sender, string $url, ?string $name, $expiresAt): array
    {
        $body = $expiresAt ? '<p>This link expires on '.e($expiresAt->format('j M Y')).'.</p>' : null;

        return [
            'preheader' => 'A document is still waiting for your signature.',
            'eyebrow' => 'Reminder',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => 'A quick reminder',
            'lead' => $title.' is still waiting for your signature'.($sender ? ', sent by '.$sender : '').'.',
            'bodyHtml' => $body,
            'button' => ['label' => 'Review & sign', 'url' => $url],
        ];
    }

    /** @param array<int,string> $signers */
    public static function signatureCompleted(string $title, ?string $name, array $signers, bool $attached, string $url): array
    {
        $body = $signers ? '<p>Signed by: '.e(implode(', ', $signers)).'.</p>' : '';
        $body .= $attached
            ? '<p>The signed copy is attached to this email for your records.</p>'
            : '<p>We\'re still preparing the signed copy, it\'ll follow shortly.</p>';

        return [
            'preheader' => 'Everyone has now signed the document.',
            'eyebrow' => 'Signed',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => 'Your document is signed',
            'lead' => 'Everyone has now signed '.$title.'.',
            'bodyHtml' => $body,
            'button' => ['label' => 'View in Signatures', 'url' => $url],
        ];
    }

    public static function signatureDeclined(string $title, ?string $reason, ?string $by, string $url): array
    {
        return [
            'preheader' => 'A signature request was declined.',
            'eyebrow' => 'Signature',
            'title' => 'A signature was declined',
            'lead' => $title.' was declined'.($by ? ' by '.$by : '').'. Nobody else can sign it now.',
            'quote' => $reason ?: null,
            'button' => ['label' => 'Open Signatures', 'url' => $url],
        ];
    }

    public static function signatureChangesRequested(string $title, ?string $comment, ?string $by, string $url): array
    {
        return [
            'preheader' => 'A reviewer asked for changes before approving.',
            'eyebrow' => 'Signature',
            'title' => 'Changes were requested',
            'lead' => $title.' was reviewed'.($by ? ' by '.$by : '').', who asked for changes before approving.',
            'quote' => $comment ?: null,
            'bodyHtml' => '<p>The request is on hold until you revise and resend it.</p>',
            'button' => ['label' => 'Open Signatures', 'url' => $url],
        ];
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
        return new Postcard('You have been invited to the '.self::SITE.' portal', [
            'preheader' => $hasAccount
                ? 'Sign in to accept your invitation to the portal.'
                : 'Create your account to see the files we\'re working on together.',
            'eyebrow' => 'You\'re invited',
            'greeting' => $name ? "Hello {$name}," : 'Hello,',
            'title' => $hasAccount ? 'Accept your invitation' : 'Connect to your files',
            'lead' => ($inviter ? e($inviter).' has added you' : 'You have been added')
                .' to the '.self::SITE.' portal.',
            'bodyHtml' => '<p>Through the portal you can reach your bookings, events, files, documents, contracts, invoices and updates, all in one place.</p>'
                .($hasAccount
                    ? '<p>You already have an account with this email address, so just sign in and the invitation will be added to it.</p>'
                    : '<p>Creating your account links it to your existing records with us automatically.</p>'),
            'details' => self::expiryDetails($expiresAt),
            'button' => [
                'label' => $hasAccount ? 'Sign in and accept' : 'Create your account',
                'url' => $url,
            ],
            'footNote' => 'If you weren\'t expecting this invitation you can ignore this email, or contact us at support@tmantoine.com.',
        ]);
    }

    public static function clientInviteReminder(
        ?string $name,
        string $url,
        ?\DateTimeInterface $expiresAt = null,
    ): Postcard {
        return new Postcard('Reminder: your '.self::SITE.' invitation is waiting', [
            'preheader' => 'Your invitation is still waiting, it takes about a minute.',
            'greeting' => $name ? "Hello {$name}," : 'Hello,',
            'title' => 'Your invitation is still waiting',
            'lead' => 'Setting up your account takes about a minute.',
            'bodyHtml' => '<p>A little while ago we invited you to connect to your files with '.self::SITE.'. Your secure space is ready whenever you are.</p>',
            'details' => self::expiryDetails($expiresAt),
            'button' => ['label' => 'Finish setting up', 'url' => $url],
        ]);
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

        return new Postcard('You have been invited to join '.self::SITE, [
            'preheader' => 'Set up your account to get started.',
            'eyebrow' => 'You\'re invited',
            'greeting' => $name ? "Hello {$name}," : 'Hello,',
            'title' => 'Join the '.self::SITE.' team',
            'lead' => ($inviter ? e($inviter).' has invited you' : 'You have been invited')
                .' to join '.self::SITE.' on the portal.',
            'bodyHtml' => '<p>The portal is where the team works with clients, files, documents, signatures, calendars, messages and email in one place.</p>'
                .($hasAccount
                    ? '<p>You already have an account with this email address, so just sign in and your new access will be added to it.</p>'
                    : '<p>Use the button below to set up your account and choose a password.</p>'),
            'details' => $details,
            'button' => [
                'label' => $hasAccount ? 'Sign in and accept' : 'Set up your account',
                'url' => $url,
            ],
            'footNote' => 'If you weren\'t expecting this invitation you can ignore this email, or contact us at support@tmantoine.com.',
        ]);
    }

    /** The invitation someone receives when added to a company account. */
    public static function companyMemberInvite(
        ?string $name,
        string $companyName,
        string $url,
        string $companyRole,
        ?string $inviter = null,
        ?\DateTimeInterface $expiresAt = null,
        bool $hasAccount = false,
    ): Postcard {
        return new Postcard('You have been added to '.$companyName.' on '.self::SITE, [
            'preheader' => 'Your company access is ready.',
            'eyebrow' => 'Company access',
            'greeting' => $name ? "Hello {$name}," : 'Hello,',
            'title' => 'You have been added to '.$companyName,
            'lead' => ($inviter ? e($inviter).' has added you' : 'You have been added')
                .' as a member of '.e($companyName).' on the '.self::SITE.' portal.',
            'bodyHtml' => '<p>Your access may include company bookings, events, files, contracts, invoices and updates, based on the permissions set for your role.</p>'
                .($hasAccount
                    ? '<p>You already have an account with this email address, so just sign in and this company will be added to it.</p>'
                    : '<p>Use the button below to create your account and get started.</p>'),
            'details' => array_merge(
                [['Company', e($companyName)], ['Your role', e($companyRole)]],
                self::expiryDetails($expiresAt),
            ),
            'button' => ['label' => 'Access company portal', 'url' => $url],
            'footNote' => 'If you weren\'t expecting this invitation you can ignore this email, or contact us at support@tmantoine.com.',
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
        return new Postcard('You have been assigned to '.$clientName, [
            'preheader' => 'A client has been assigned to you.',
            'eyebrow' => 'Client assignment',
            'greeting' => "Hello {$staffName},",
            'title' => 'You are now working with '.$clientName,
            'lead' => ($assigner ? e($assigner).' assigned you' : 'You have been assigned')
                .' to '.e($clientName).'.',
            'details' => array_filter([
                ['Client', e($clientName)],
                ['Your role', e($roleLabel)],
                $isPrimary ? ['Primary contact', 'Yes'] : null,
            ]),
            'button' => ['label' => 'Open the client', 'url' => $url],
        ]);
    }

    /** Told to a client when a staff member becomes their contact. */
    public static function clientStaffAssigned(
        ?string $clientName,
        string $staffName,
        ?string $staffTitle,
        string $url,
    ): Postcard {
        return new Postcard($staffName.' is now your contact at '.self::SITE, [
            'preheader' => 'Say hello to your point of contact.',
            'eyebrow' => 'Your team',
            'greeting' => $clientName ? "Hello {$clientName}," : 'Hello,',
            'title' => 'Meet your point of contact',
            'lead' => e($staffName).' will be looking after your work with '.self::SITE.'.',
            'bodyHtml' => '<p>You can reach them through the portal at any time, messages, files and updates all stay in one place.</p>',
            'details' => array_filter([
                ['Contact', e($staffName)],
                $staffTitle ? ['Role', e($staffTitle)] : null,
            ]),
            'button' => ['label' => 'Open the portal', 'url' => $url],
        ]);
    }

    /** Told to the inviter once someone accepts. */
    public static function invitationAccepted(
        string $recipientName,
        string $whoAccepted,
        string $whatFor,
        string $url,
    ): Postcard {
        return new Postcard($whoAccepted.' has joined the portal', [
            'preheader' => 'Your invitation was accepted.',
            'eyebrow' => 'Invitation accepted',
            'greeting' => "Hello {$recipientName},",
            'title' => $whoAccepted.' has joined',
            'lead' => e($whoAccepted).' accepted their invitation and now has access to '.e($whatFor).'.',
            'button' => ['label' => 'Open the portal', 'url' => $url],
        ]);
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
        return new Postcard($sharer.' shared '.($isFolder ? 'a folder' : 'a file').' with you', [
            'preheader' => 'A new '.($isFolder ? 'folder' : 'document').' is waiting for you in the portal.',
            'title' => $sharer.' shared '.($isFolder ? 'a folder' : 'a file').' with you',
            'lead' => 'It\'s ready for you in your space.',
            'files' => [[$itemName, $isFolder ? 'Folder' : 'File']],
            'quote' => $note ?: null,
            'button' => ['label' => 'View in the portal', 'url' => $url],
        ]);
    }

    /**
     * "Please upload these documents", the invitation to a secure upload link.
     *
     * The recipient has no account and may never have used the portal, so the
     * copy says what will happen to the files rather than assuming they know:
     * the link only accepts uploads, and it goes to one place.
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
        return new Postcard($requester.' asked you for documents', [
            'preheader' => $title.', upload securely, no account needed.',
            'eyebrow' => 'Document request',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => $requester.' asked you for documents',
            'lead' => $title,
            'bodyHtml' => '<p>Use the button below to upload your files securely. '
                .'You don\'t need an account, and the link only lets you add files, '
                .'nothing else in the workspace is visible.</p>',
            'quote' => $message ?: null,
            'details' => $details,
            'button' => ['label' => 'Upload your files', 'url' => $url],
        ]);
    }

    /** The requester's copy: something arrived through one of their links. */
    public static function fileRequestReceived(
        string $title,
        int $count,
        ?string $from,
        string $url,
        ?string $name = null,
    ): Postcard {
        $what = $count === 1 ? 'A file' : $count.' files';

        return new Postcard($what.' arrived for “'.$title.'”', [
            'preheader' => $what.' just came in through your document request.',
            'eyebrow' => 'Document request',
            'greeting' => $name ? "Hi {$name}," : null,
            'title' => $what.' arrived',
            'lead' => ($from ? $from.' uploaded ' : 'Someone uploaded ')
                .($count === 1 ? 'a file' : $count.' files').' to “'.$title.'”.',
            'button' => ['label' => 'Open the folder', 'url' => $url],
        ]);
    }

    // ----------------------------------------------------------- message reminders

    /** $tier: 1 (~1h), 2 (~20h), 3 (~24h, final). */
    public static function messageReminder(int $tier, string $from, ?string $preview, string $url): Postcard
    {
        $payload = match ($tier) {
            2 => [
                'subject' => 'Still waiting to hear from you',
                'eyebrow' => 'Reminder',
                'title' => 'Still waiting to hear from you',
                'lead' => 'We reached out and haven\'t heard back. Your message is still waiting in the portal.',
                'button' => ['label' => 'Read and reply', 'url' => $url],
            ],
            3 => [
                'subject' => 'A message from us is still waiting for you',
                'eyebrow' => 'Final reminder',
                'title' => 'A message from us is still waiting for you',
                'lead' => 'It\'s been a full day and we still haven\'t heard back, here\'s one last reminder.',
                'bodyHtml' => '<p>If now isn\'t a good time, no problem, the message will be waiting whenever you\'re ready.</p>',
                'button' => ['label' => 'Open the conversation', 'url' => $url],
            ],
            default => [
                'subject' => 'You have a new message from '.$from,
                'title' => 'You have a new message',
                'lead' => $from.' sent you a message about an hour ago and it\'s still unread.',
                'button' => ['label' => 'Read the message', 'url' => $url],
            ],
        };

        return new Postcard($payload['subject'], array_merge([
            'preheader' => 'Your message from '.$from.' is still unread.',
            'quote' => $preview,
        ], $payload));
    }

    // --------------------------------------------------------------------- teams

    public static function teamAdded(string $addedBy, string $groupName, string $url): Postcard
    {
        return new Postcard('You were added to '.$groupName, [
            'preheader' => $addedBy.' added you to a team in the portal.',
            'eyebrow' => 'Teams',
            'title' => 'You were added to '.$groupName,
            'lead' => $addedBy.' added you to a team in the portal.',
            'bodyHtml' => '<p>You can now see the team\'s shared files, calendar and conversations, and reach everyone on it in one place.</p>',
            'button' => ['label' => 'Open the team', 'url' => $url],
        ]);
    }

    // ------------------------------------------------------------------ calendar

    /** @param array<string,mixed> $p the EventNotifier payload. */
    public static function calendar(string $kind, array $p): array
    {
        $title = $p['title'] ?? 'Event';
        $name = $p['name'] ?? null;
        $organizer = $p['organizer'] ?? null;
        $url = $p['url'] ?? null;

        $details = [];
        if (! empty($p['whenLabel'])) {
            $details[] = ['When', e($p['whenLabel'])];
        }
        if (! empty($p['location'])) {
            $details[] = ['Where', e($p['location'])];
        }
        if ($organizer) {
            $details[] = ['Organizer', e($organizer)];
        }

        $payload = [
            'eyebrow' => 'Calendar',
            'greeting' => $name ? "Hi {$name}," : null,
            'details' => $details ?: null,
            // Raw: the postcard template escapes `quote` itself now, so
            // escaping here as well would show visitors "&amp;" and "&lt;".
            'quote' => ! empty($p['description']) ? $p['description'] : null,
        ];

        [$payload['title'], $payload['lead'], $label] = match ($kind) {
            'updated' => [
                $title.' has changed',
                $organizer ? $organizer.' updated this event.' : 'This event was updated.',
                'Open in the portal',
            ],
            'cancelled' => [
                $title.' was cancelled',
                ($organizer ? $organizer.' cancelled this event.' : 'This event was cancelled.').' It has been taken off your calendar.',
                'Open your calendar',
            ],
            'response' => [
                ($p['attendee'] ?? 'Someone').' '.($p['responseLabel'] ?? 'responded'),
                ($p['attendee'] ?? 'Someone').' '.($p['responseLabel'] ?? 'responded').' your invitation to '.$title.'.',
                'See all responses',
            ],
            default => [
                $organizer ? $organizer.' invited you to '.$title : 'You have been invited to '.$title,
                'Here are the details.',
                'Open in the portal',
            ],
        };

        if ($kind === 'updated' && ! empty($p['changes'])) {
            $payload['bodyHtml'] = '<p><strong>What changed:</strong> '.e(implode(', ', $p['changes'])).'</p>';
        }

        if ($url) {
            $payload['button'] = ['label' => $label, 'url' => $url];
        }

        return $payload;
    }

    // ------------------------------------------------------------------- cip

    /**
     * §10's assignment notice: the file has been handed to this officer.
     *
     * The subject is §22's compliance format, not prose —
     *
     *   RO - REVIEW APPLICATION - GAL26-00001 - JOHN SMITH (F4) - 17.08.2026
     *
     * because these emails are filed, and a mailbox full of them is sorted and
     * searched by exactly those fields. The body carries what §10 names: the
     * application number, the applicant, the provider firm, and a direct link.
     *
     * The number is displayNumber(), so a file the Unit has already numbered
     * announces itself by the CIP number. §7's switching rule reaches email
     * subjects through the same accessor as every screen.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int, statusLabel:string, roleLabel:string}  $facts
     */
    public static function cipAssigned(array $facts, ?User $officer, string $url, ?string $subject = null, ?string $recipientName = null): Postcard
    {
        $subject ??= Notices::line($facts, Status::REVIEW_APPLICATION, $officer);
        $hello = $recipientName ?: $officer?->name;

        return new Postcard($subject, [
            'preheader' => $facts['number'].': '.$facts['applicant'].' is now at '.$facts['statusLabel'].'.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $hello ? 'Hi '.(strtok($hello, ' ') ?: $hello).',' : 'Hello,',
            'title' => $facts['number'].' is in review',
            'lead' => $facts['number'].' stands at '.$facts['statusLabel'].'.',
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
                ['Status', $facts['statusLabel']],
                ['Family size', 'F'.$facts['familySize']],
            ],
            'button' => ['label' => 'Open the application', 'url' => $url],
        ]);
    }

    /**
     * §14's notice to the provider side: documents have been sent back.
     *
     * Fired when the APPLICATION reaches Updates required, not per document —
     * an officer working through a checklist in one sitting must not put five
     * emails in the firm's inbox saying pieces of one fact. The body lists
     * every document sent back so far, each with the reviewer's reason,
     * because §12 promises the provider is told what needs work without
     * clicking through documents to find it.
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

        return new Postcard($subject, [
            'preheader' => $facts['number'].': '.$count.' document'.($count === 1 ? '' : 's').' need'.($count === 1 ? 's' : '').' an update.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Hi '.(strtok($recipientName, ' ') ?: $recipientName).',' : 'Hello,',
            'title' => 'Updates required on '.$facts['number'],
            'lead' => 'The reviewing officer has assessed '.$facts['applicant'].'’s documents and sent '
                .($count === 1 ? 'one back' : $count.' back').' with notes.',
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
            ],
            'bodyHtml' => '<ul>'.$list.'</ul>',
            'button' => ['label' => 'Open the documents', 'url' => $url],
        ]);
    }

    /**
     * §15's notice to the provider side: the file is ready, confirm it.
     *
     * Fired when the APPLICATION reaches Ready to submit, every required
     * document accepted, nothing sent back. The body is the ask: press Confirm
     * submission, after which the original package cannot be modified.
     *
     * @param  array{number:string, applicant:string, provider:string, familySize:int}  $facts
     */
    public static function cipReadyToSubmit(array $facts, string $url, ?string $recipientName = null, ?string $subject = null): Postcard
    {
        $subject ??= Notices::line($facts, Status::READY_TO_SUBMIT);

        return new Postcard($subject, [
            'preheader' => $facts['number'].' is ready to submit, confirm to lock the original package.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Hi '.(strtok($recipientName, ' ') ?: $recipientName).',' : 'Hello,',
            'title' => $facts['number'].' is ready to submit',
            'lead' => 'Assessment feedback is complete, '.$facts['applicant'].'’s file is ready to submit. Confirm submission to lock the original package.',
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
            ],
            'button' => ['label' => 'Confirm submission', 'url' => $url],
        ]);
    }

    /**
     * §18's notice to the provider side: the Unit has asked for more.
     *
     * Fired when staff record the Query received date and the file moves to
     * Non-compliant. The body names Additional Documents, because that is the
     * only drawer still writable after confirm submission.
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

        return new Postcard($subject, [
            'preheader' => $facts['number'].' is non-compliant, the Unit has requested additional information.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Hi '.(strtok($recipientName, ' ') ?: $recipientName).',' : 'Hello,',
            'title' => $facts['number'].' is non-compliant',
            'lead' => 'The Unit has requested additional information on '.$facts['applicant'].'’s file. Upload the required documents through Additional Documents.',
            'details' => $details,
            'button' => ['label' => 'Open Additional Documents', 'url' => $url],
        ]);
    }

    /**
     * §20's notice: 180 days after acceptance, still no decision.
     *
     * Fired by the daily job, not by a person. Initials are the assigned
     * reviewing officer's when there is one.
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

        return new Postcard($subject, [
            'preheader' => $facts['number'].' is delayed, '.$days.' days with no decision.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Hi '.(strtok($recipientName, ' ') ?: $recipientName).',' : 'Hello,',
            'title' => $facts['number'].' is delayed',
            'lead' => $days.' days have passed since '.$facts['applicant'].'’s file was accepted for processing, and no decision has been recorded.',
            'details' => $details,
            'button' => ['label' => 'Open the application', 'url' => $url],
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
        ?\App\Models\FileItem $attachment = null,
    ): Postcard {
        $subject ??= Notices::line($facts, $decision, $actor);
        $granted = $decision === Status::GRANTED;

        $details = [
            ['Application', $facts['number']],
            ['Applicant', $facts['applicant']],
            ['Service provider', $facts['provider']],
            ['Decision', Status::label($decision)],
        ];
        if ($decidedAt) {
            $details[] = ['Decision date', $decidedAt];
        }

        $title = $copy['title'] ?? ($facts['number'].' was '.strtolower(Status::label($decision)));
        $lead = $copy['lead'] ?? ($granted
            ? 'The Unit has granted '.$facts['applicant'].'’s application.'
            : 'The Unit has denied '.$facts['applicant'].'’s application.');

        $payload = [
            'preheader' => $facts['number'].' was '.strtolower(Status::label($decision)).'.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Dear '.$recipientName.',' : 'Dear Sir/Madam,',
            'title' => $title,
            'lead' => $lead,
            'details' => $details,
            'button' => ['label' => 'Open the application', 'url' => $url],
        ];
        if (! empty($copy['bodyHtml'])) {
            $payload['bodyHtml'] = $copy['bodyHtml'];
        }

        return new Postcard($subject, $payload, attachment: $attachment);
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

        return new Postcard($subject, [
            'preheader' => $facts['number'].' now stands at '.$label.'.',
            'eyebrow' => 'CIP Applications',
            'greeting' => $recipientName ? 'Hi '.(strtok($recipientName, ' ') ?: $recipientName).',' : 'Hello,',
            'title' => $facts['number'].': '.$label,
            'lead' => $facts['applicant'].'’s application now stands at '.$label.'.',
            'details' => [
                ['Application', $facts['number']],
                ['Applicant', $facts['applicant']],
                ['Service provider', $facts['provider']],
                ['Status', $label],
                ['Family size', 'F'.$facts['familySize']],
            ],
            'button' => ['label' => 'Open the application', 'url' => $url],
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

        return new Postcard($title, array_filter([
            'preheader' => $message ?: $title,
            'eyebrow' => ucfirst($module ?: 'notification'),
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => $title,
            'bodyHtml' => $message ? '<p>'.e($message).'</p>' : null,
            'button' => $url ? ['label' => $actionLabel ?: 'Open the portal', 'url' => $url] : null,
        ]));
    }
}
