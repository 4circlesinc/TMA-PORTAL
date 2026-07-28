<?php

namespace App\Support\Mail;

use App\Mail\Postcard;

/**
 * The copy for every transactional email, one factory method each. Each returns
 * a ready-to-send App\Mail\Postcard; dynamic values (links, names, codes) are
 * arguments. Keeping the wording here — rather than scattered across triggers —
 * keeps the sent emails matching the approved /design/mail gallery.
 */
class Postcards
{
    private const SITE = 'TM ANTOINE Advisory';

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
                .'<p>If you didn\'t ask to reset your password, you can safely ignore this email — your current password still works.</p>',
            'button' => ['label' => 'Choose a new password', 'url' => $url],
        ]);
    }

    /** Build the "password changed" email for a user from the current request. */
    public static function passwordChangedFor(\App\Models\User $user): Postcard
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
            'quote' => 'Didn\'t make this change? Reset your password immediately and contact us — someone else may have access to your account.',
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
            'preheader' => 'Your account has been approved — here\'s how to get started.',
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

    public static function newLogin(array $details, string $reviewUrl): Postcard
    {
        return new Postcard('New sign-in to your account', [
            'preheader' => 'A new device just signed in to your account.',
            'eyebrow' => 'Security',
            'title' => 'New sign-in to your account',
            'lead' => 'We noticed a sign-in from a device we don\'t recognise.',
            'details' => $details,
            'quote' => 'Don\'t recognise this? Secure your account now — we recommend changing your password and reviewing your active sessions.',
            'button' => ['label' => 'Review activity', 'url' => $reviewUrl],
        ]);
    }

    // ---------------------------------------------------------------- signatures
    // These return payload arrays (the mailables keep their own subject lines).

    public static function signatureInvitation(string $title, ?string $sender, ?string $note, string $url, ?string $name, $expiresAt, string $action): array
    {
        $body = '<p>You can '.$action.' <strong>'.e($title).'</strong> online — no account needed.</p>';
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
            : '<p>We\'re still preparing the signed copy — it\'ll follow shortly.</p>';

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

    public static function clientInvite(?string $name, string $url, ?string $inviter = null): Postcard
    {
        return new Postcard('Connect to your files with '.self::SITE, [
            'preheader' => 'Create your account to see the files we\'re working on together.',
            'eyebrow' => 'You\'re invited',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'Connect to your files',
            'lead' => self::SITE.' has set up a secure space for you.',
            'bodyHtml' => '<p>Create your account to see the files we\'re working on together, message us directly, and follow along as things progress — all in one place.</p>'
                .'<p>Creating your account links it to your existing records with us automatically.</p>'
                .($inviter ? '<p>This invitation was set up for you by '.e($inviter).'.</p>' : ''),
            'button' => ['label' => 'Create your account', 'url' => $url],
        ]);
    }

    public static function clientInviteReminder(?string $name, string $url): Postcard
    {
        return new Postcard('Reminder: finish connecting to your files', [
            'preheader' => 'Your invitation is still waiting — it takes about a minute.',
            'greeting' => $name ? "Hi {$name}," : 'Hello,',
            'title' => 'Your invitation is still waiting',
            'lead' => 'Setting up your account takes about a minute.',
            'bodyHtml' => '<p>A little while ago we invited you to connect to your files with '.self::SITE.'. Your secure space is ready whenever you are.</p>',
            'button' => ['label' => 'Finish setting up', 'url' => $url],
        ]);
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
                'lead' => 'It\'s been a full day and we still haven\'t heard back — here\'s one last reminder.',
                'bodyHtml' => '<p>If now isn\'t a good time, no problem — the message will be waiting whenever you\'re ready.</p>',
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
            'quote' => ! empty($p['description']) ? e($p['description']) : null,
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
}
