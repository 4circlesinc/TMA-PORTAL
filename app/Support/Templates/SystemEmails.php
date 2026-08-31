<?php

namespace App\Support\Templates;

use App\Models\Template;
use App\Models\User;
use Illuminate\Support\HtmlString;
use Illuminate\Validation\ValidationException;

/**
 * Every transactional email the portal sends, as editable copy.
 *
 * The catalog below is the shipped wording — the same copy Postcards used to
 * hard-code, with the dynamic parts as {{placeholders}} (see Markup). An
 * administrator's rewording is a Template row; a template with no row sends
 * its default, and "Restore default" just deletes the row. Postcards builds
 * each email through {@see self::payload()}, so an edit on the Templates
 * page is what every future send of that email says.
 *
 * Structure (details rows, attachment lists, quoted user text, button URLs)
 * stays with the factory in Postcards: those carry data, not wording, except
 * where the wording IS the field (a quote that is fixed copy is editable
 * here; a quote that is something a person typed is not).
 */
class SystemEmails
{
    public const KIND = 'system-email';

    /** Field order, which is also the editor's order. */
    public const FIELDS = ['subject', 'preheader', 'eyebrow', 'greeting', 'title', 'lead', 'body', 'quote', 'button', 'footNote'];

    /** Fields rendered as HTML through Markup::html; the rest are text. */
    public const HTML_FIELDS = ['body', 'footNote'];

    public const FIELD_LABELS = [
        'subject' => 'Subject',
        'preheader' => 'Preview line',
        'eyebrow' => 'Eyebrow',
        'greeting' => 'Greeting',
        'title' => 'Title',
        'lead' => 'Lead',
        'body' => 'Body',
        'quote' => 'Callout',
        'button' => 'Button label',
        'footNote' => 'Fine print',
    ];

    private const HI = '{{#name}}Hi {{name}},{{/name}}';

    private const HI_OR_HELLO = '{{#name}}Hi {{name}},{{/name}}{{^name}}Hello,{{/name}}';

    private const HELLO = '{{#name}}Hello {{name}},{{/name}}{{^name}}Hello,{{/name}}';

    private const CIP_HI = '{{#recipient}}Hi {{recipient}},{{/recipient}}{{^recipient}}Hello,{{/recipient}}';

    private const CIP_FOOT = 'This is an automated notice from {{site}}. If this does not look right, reply to this email or contact us at support@tmantoine.com.';

    private const IGNORE_NOTE = "If you weren't expecting this invitation you can ignore this email, or contact us at support@tmantoine.com.";

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::catalog());
    }

    /** @return array<string, mixed> */
    public static function definition(string $key): array
    {
        $definition = self::catalog()[$key] ?? null;

        if ($definition === null) {
            throw new \InvalidArgumentException('Unknown system email template: '.$key);
        }

        return $definition;
    }

    /** The shipped copy for one template. @return array<string, string> */
    public static function defaults(string $key): array
    {
        return self::definition($key)['copy'];
    }

    /** The template's copy as it stands: defaults overlaid by any saved edit. */
    public static function copy(string $key): array
    {
        $copy = self::defaults($key);
        $saved = self::override($key)?->fields ?? [];

        foreach (self::editableFields($key) as $field) {
            if (array_key_exists($field, $saved) && is_string($saved[$field])) {
                $copy[$field] = $saved[$field];
            }
        }

        return $copy;
    }

    public static function override(string $key): ?Template
    {
        return Template::query()->where('kind', self::KIND)->where('key', $key)->first();
    }

    public static function isCustomized(string $key): bool
    {
        return self::override($key) !== null;
    }

    /**
     * Fields the editor offers: the ones the shipped copy uses, minus any the
     * definition pins (a CIP subject stays in the filing format).
     *
     * @return list<string>
     */
    public static function editableFields(string $key): array
    {
        $definition = self::definition($key);
        $fixed = $definition['fixed'] ?? [];

        return array_values(array_filter(
            self::FIELDS,
            fn (string $f) => array_key_exists($f, $definition['copy']) && ! in_array($f, $fixed, true),
        ));
    }

    /**
     * Placeholder tokens this template may use, token => meaning.
     *
     * @return array<string, string>
     */
    public static function variables(string $key): array
    {
        return self::definition($key)['variables'] + ['site' => "The firm's name"];
    }

    /**
     * Subject and postcard payload for one send: current copy, placeholders
     * filled, structure from $extras merged in.
     *
     * $extras: subject (a caller-fixed subject wins), url (the button's),
     * details, files, quote, code, attachment.
     *
     * @return array{subject: string, payload: array<string, mixed>}
     */
    public static function payload(string $key, array $vars, array $extras = [], ?array $copy = null): array
    {
        $copy ??= self::copy($key);
        $vars += ['site' => \App\Support\Mail\Postcards::site()];

        $rendered = [];
        foreach (self::FIELDS as $field) {
            $text = $copy[$field] ?? '';
            if (trim($text) === '') {
                continue;
            }
            $value = in_array($field, self::HTML_FIELDS, true)
                ? Markup::html($text, $vars)
                : trim(Markup::fill($text, $vars));
            if ($value !== '') {
                $rendered[$field] = $value;
            }
        }

        $payload = array_filter([
            'preheader' => $rendered['preheader'] ?? null,
            'eyebrow' => $rendered['eyebrow'] ?? null,
            'greeting' => $rendered['greeting'] ?? null,
            'title' => $rendered['title'] ?? null,
            'lead' => $rendered['lead'] ?? null,
            'bodyHtml' => $rendered['body'] ?? null,
            'details' => $extras['details'] ?? null,
            'files' => $extras['files'] ?? null,
            'quote' => $extras['quote'] ?? $rendered['quote'] ?? null,
            'code' => $extras['code'] ?? null,
            'button' => isset($rendered['button'], $extras['url']) && $extras['url'] !== ''
                ? ['label' => $rendered['button'], 'url' => $extras['url']]
                : null,
            'footNote' => $rendered['footNote'] ?? null,
        ], fn ($v) => $v !== null && $v !== '' && $v !== []);

        return [
            'subject' => $extras['subject'] ?? $rendered['subject'] ?? ($payload['title'] ?? ''),
            'payload' => $payload,
        ];
    }

    /**
     * The email as the recipient would see it, rendered with sample values.
     * $draft (field => text) previews unsaved edits.
     *
     * @return array{subject: string, html: string}
     */
    public static function preview(string $key, ?array $draft = null): array
    {
        $definition = self::definition($key);
        $copy = self::copy($key);

        foreach ($draft ?? [] as $field => $text) {
            if (in_array($field, self::editableFields($key), true) && is_string($text)) {
                $copy[$field] = $text;
            }
        }

        $extras = ($definition['sampleExtras'] ?? []) + ['url' => url('/')];
        $built = self::payload($key, $definition['sample'] + ['url' => url('/')], $extras, $copy);

        if (! isset($built['payload']['title'])) {
            $built['payload']['title'] = $definition['name'];
        }

        return [
            'subject' => $built['subject'],
            'html' => view('emails.postcard', $built['payload'])->render(),
        ];
    }

    /**
     * Save an administrator's copy. Unknown placeholders are rejected so a
     * typo is caught at the desk, not discovered in a customer's inbox. A
     * save that matches the shipped copy exactly is a restore.
     */
    public static function save(string $key, array $fields, ?User $by = null): void
    {
        $defaults = self::defaults($key);
        $clean = [];

        foreach (self::editableFields($key) as $field) {
            if (! array_key_exists($field, $fields)) {
                continue;
            }
            $text = is_string($fields[$field]) ? trim($fields[$field]) : '';

            if ($text === '' && in_array($field, ['subject', 'title'], true) && trim($defaults[$field] ?? '') !== '') {
                throw ValidationException::withMessages([
                    $field => [self::FIELD_LABELS[$field].' cannot be empty.'],
                ]);
            }

            $known = array_keys(self::variables($key));
            foreach (Markup::tokens($text) as $token) {
                if (! in_array($token, $known, true)) {
                    throw ValidationException::withMessages([
                        $field => ['This email has no {{'.$token.'}} placeholder. It offers: '.implode(', ', array_map(fn ($t) => '{{'.$t.'}}', $known)).'.'],
                    ]);
                }
            }

            $clean[$field] = $text;
        }

        $unchanged = true;
        foreach (self::editableFields($key) as $field) {
            if (($clean[$field] ?? trim($defaults[$field] ?? '')) !== trim($defaults[$field] ?? '')) {
                $unchanged = false;
                break;
            }
        }

        if ($unchanged) {
            self::restore($key);

            return;
        }

        Template::query()->updateOrCreate(
            ['kind' => self::KIND, 'key' => $key],
            ['fields' => $clean, 'updated_by' => $by?->id],
        );
    }

    public static function restore(string $key): void
    {
        Template::query()->where('kind', self::KIND)->where('key', $key)->delete();
    }

    /** Every template, catalog order. @return array<string, array<string, mixed>> */
    public static function catalog(): array
    {
        return self::account()
            + self::security()
            + self::signatures()
            + self::invitations()
            + self::companies()
            + self::clients()
            + self::files()
            + self::messages()
            + self::calendar()
            + self::cip()
            + self::notifications();
    }

    private static function account(): array
    {
        $name = ['name' => "The recipient's first name, when known"];
        $url = ['url' => 'Where the button goes'];
        $email = ['email' => "The account's email address"];

        return [
            'verify-email' => [
                'name' => 'Confirm email address',
                'category' => 'Account',
                'when' => 'Sent when someone creates an account, to confirm the address is theirs.',
                'variables' => $name + $url,
                'sample' => ['name' => 'Ada'],
                'copy' => [
                    'subject' => 'Confirm your email address',
                    'preheader' => 'One tap confirms your email and finishes setting up your account.',
                    'greeting' => self::HI,
                    'title' => 'Confirm your email address',
                    'lead' => 'Thanks for creating an account with {{site}}.',
                    'body' => "Confirm this is your email address and we'll finish setting things up.",
                    'button' => 'Confirm email address',
                ],
            ],
            'reset-password' => [
                'name' => 'Reset password',
                'category' => 'Account',
                'when' => 'Sent when someone asks for a password reset link.',
                'variables' => $name + $url,
                'sample' => ['name' => 'Ada'],
                'copy' => [
                    'subject' => 'Reset your password',
                    'preheader' => 'Use the button below to choose a new password.',
                    'eyebrow' => 'Security',
                    'greeting' => self::HI,
                    'title' => 'Reset your password',
                    'lead' => 'We received a request to reset your password.',
                    'body' => "Choose a new password using the button below. This link expires in 60 minutes and can only be used once.\n\nIf you didn't ask to reset your password, you can safely ignore this email, your current password still works.",
                    'button' => 'Choose a new password',
                ],
            ],
            'change-email' => [
                'name' => 'Confirm new email address',
                'category' => 'Account',
                'when' => 'Sent to the new address when someone changes the email on their account.',
                'variables' => $url + ['newEmail' => 'The address being confirmed'],
                'sample' => ['newEmail' => 'ada@example.com'],
                'copy' => [
                    'subject' => 'Confirm your new email address',
                    'preheader' => 'Confirm the new email address for your account.',
                    'title' => 'Confirm your new email address',
                    'lead' => 'You asked to change the email on your account.',
                    'body' => 'Confirm **{{newEmail}}** to start using it. This link expires in 60 minutes; until you confirm, your account keeps using its current email.',
                    'button' => 'Confirm new email',
                ],
            ],
            'welcome' => [
                'name' => 'Account approved',
                'category' => 'Account',
                'when' => 'Sent when an administrator approves an account. A note typed on approval rides along as a callout.',
                'variables' => $name + $url + $email,
                'sample' => ['name' => 'Ada', 'email' => 'ada@example.com'],
                'sampleExtras' => ['quote' => 'Welcome aboard — call me if you get stuck.'],
                'copy' => [
                    'subject' => 'Your account is ready',
                    'preheader' => "Your account has been approved, here's how to get started.",
                    'eyebrow' => 'Welcome',
                    'greeting' => self::HI_OR_HELLO,
                    'title' => 'Your account is approved and ready',
                    'body' => "An administrator has approved your account. You now have access to your files, messages, calendar and everything the firm shares with you.\n\nHere's your sign-in address in case you forget: [{{email}}]({{url}})\n\nIf you need any help getting started, reach out at support@tmantoine.com.",
                    'button' => 'Open the portal',
                ],
            ],
            'account-pending' => [
                'name' => 'Request received',
                'category' => 'Account',
                'when' => 'Sent the moment a self-registration lands, while it waits for review.',
                'variables' => $name + $email,
                'sample' => ['name' => 'Ada', 'email' => 'ada@example.com'],
                'copy' => [
                    'subject' => "We've received your request for access",
                    'preheader' => 'Your account request is with our team for review.',
                    'eyebrow' => 'Account request',
                    'greeting' => self::HI_OR_HELLO,
                    'title' => "We've received your request",
                    'lead' => 'Thanks for signing up to {{site}}.',
                    'body' => "Your account for **{{email}}** has been created and is now waiting for an administrator to review it. You won't be able to sign in until it's approved.\n\nWe'll email you as soon as a decision has been made, there's nothing else you need to do.",
                ],
            ],
            'account-denied' => [
                'name' => 'Request denied',
                'category' => 'Account',
                'when' => 'Sent when an administrator denies an account request. Their reason, if given, rides along as a callout.',
                'variables' => $name,
                'sample' => ['name' => 'Ada'],
                'sampleExtras' => ['quote' => 'We could not verify the company details you gave.'],
                'copy' => [
                    'subject' => 'An update on your access request',
                    'preheader' => 'A decision has been made on your account request.',
                    'eyebrow' => 'Account request',
                    'greeting' => self::HI_OR_HELLO,
                    'title' => "We couldn't approve your request",
                    'body' => "Your request for access to the {{site}} portal has been reviewed and we're not able to approve it at this time.\n\nIf you think this is a mistake, or you'd like to know more, reply to this email or contact us at support@tmantoine.com.",
                ],
            ],
            'account-deleted' => [
                'name' => 'Account closed',
                'category' => 'Account',
                'when' => "Sent when an administrator closes somebody's account.",
                'variables' => $name + $email,
                'sample' => ['name' => 'Ada', 'email' => 'ada@example.com'],
                'copy' => [
                    'subject' => 'Your account has been closed',
                    'preheader' => 'Your access to the portal has been closed.',
                    'eyebrow' => 'Account',
                    'greeting' => self::HI_OR_HELLO,
                    'title' => 'Your account has been closed',
                    'body' => "An administrator has closed the {{site}} account for **{{email}}**. You will no longer be able to sign in, and the files, messages and calendars shared with you are no longer available.\n\nIf this is unexpected, or you need anything you had stored there, reply to this email or contact us at support@tmantoine.com.",
                ],
            ],
        ];
    }

    private static function security(): array
    {
        return [
            'new-login' => [
                'name' => 'New sign-in alert',
                'category' => 'Security',
                'when' => 'Sent when a sign-in comes from a device we have not seen on the account before.',
                'variables' => ['url' => 'Where the button goes'],
                'sample' => [],
                'sampleExtras' => ['details' => [['When', '12 Aug 2026, 9:41 AM'], ['Device', 'Chrome on macOS']]],
                'copy' => [
                    'subject' => 'New sign-in to your account',
                    'preheader' => 'A new device just signed in to your account.',
                    'eyebrow' => 'Security',
                    'title' => 'New sign-in to your account',
                    'lead' => "We noticed a sign-in from a device we don't recognise.",
                    'quote' => "Don't recognise this? Secure your account now, we recommend changing your password and reviewing your active sessions.",
                    'button' => 'Review activity',
                ],
            ],
            'password-changed' => [
                'name' => 'Password changed',
                'category' => 'Security',
                'when' => "Sent to confirm the account's password was just changed.",
                'variables' => ['url' => 'Where the button goes'],
                'sample' => [],
                'sampleExtras' => ['details' => [['When', '12 Aug 2026, 9:41 AM'], ['Device', 'Chrome on macOS']]],
                'copy' => [
                    'subject' => 'Your password was changed',
                    'preheader' => 'Confirming your account password was just changed.',
                    'eyebrow' => 'Security',
                    'title' => 'Your password was changed',
                    'lead' => 'This confirms the password on your account was just changed.',
                    'quote' => "Didn't make this change? Reset your password immediately and contact us, someone else may have access to your account.",
                    'button' => 'Secure my account',
                ],
            ],
            'two-factor-changed' => [
                'name' => 'Two-factor changed',
                'category' => 'Security',
                'when' => 'Sent when two-factor authentication is turned on or off, or its recovery codes are replaced.',
                'variables' => [
                    'title' => 'What changed, as a headline',
                    'action' => 'What was done, past tense ("turned on")',
                    'url' => 'Where the button goes',
                ],
                'sample' => ['title' => 'Two-factor authentication was turned on', 'action' => 'turned on'],
                'sampleExtras' => ['details' => [['When', '12 Aug 2026, 9:41 AM'], ['Device', 'Chrome on macOS']]],
                'copy' => [
                    'subject' => '{{title}}',
                    'preheader' => 'A two-factor authentication setting on your account just changed.',
                    'eyebrow' => 'Security',
                    'title' => '{{title}}',
                    'lead' => 'Someone {{action}} two-factor authentication on your account.',
                    'quote' => "Didn't make this change? Change your password immediately and review your active sessions, someone else may have access to your account.",
                    'button' => 'Review security settings',
                ],
            ],
            'security-summary' => [
                'name' => 'Security summary',
                'category' => 'Security',
                'when' => 'The optional monthly recap of account activity.',
                'variables' => [
                    'name' => "The recipient's first name, when known",
                    'period' => 'The month the recap covers',
                    'url' => 'Where the button goes',
                ],
                'sample' => ['name' => 'Ada', 'period' => 'August'],
                'sampleExtras' => ['details' => [['Sign-ins', '14'], ['New devices', '1'], ['Password changes', '0']]],
                'copy' => [
                    'subject' => 'Your security summary for {{period}}',
                    'preheader' => 'A short recap of account activity in {{period}}.',
                    'eyebrow' => 'Security',
                    'greeting' => self::HI,
                    'title' => 'Your security summary',
                    'lead' => "Here's what happened on your account in {{period}}.",
                    'body' => 'Nothing here needs your attention unless something looks unfamiliar. You can turn this summary off under Account settings → Security.',
                    'button' => 'Review security settings',
                ],
            ],
        ];
    }

    private static function signatures(): array
    {
        $common = [
            'title' => "The document's name",
            'url' => 'Where the button goes',
        ];

        return [
            'signature-invitation' => [
                'name' => 'Signature request',
                'category' => 'Signatures',
                'when' => 'Sent when a signature request goes out. A subject the sender typed wins over the one here; their note rides along as a callout.',
                'variables' => $common + [
                    'sender' => 'Who sent the request, when known',
                    'name' => "The recipient's first name, when known",
                    'action' => 'What is asked of them: sign or approve',
                    'expires' => 'The expiry date, when the request has one',
                ],
                'sample' => ['title' => 'Engagement letter.pdf', 'sender' => 'Vernon Francis', 'name' => 'Dana', 'action' => 'sign', 'expires' => '30 Sep 2026'],
                'sampleExtras' => ['quote' => 'Please sign by Friday.'],
                'copy' => [
                    'subject' => 'Please sign: {{title}}',
                    'preheader' => '{{#sender}}{{sender}} asked you to {{action}} a document.{{/sender}}{{^sender}}A document needs your signature.{{/sender}}',
                    'eyebrow' => 'Signature',
                    'greeting' => self::HI,
                    'title' => '{{#sender}}{{sender}} asked you to {{action}} a document{{/sender}}{{^sender}}A document needs your signature{{/sender}}',
                    'body' => "You can {{action}} **{{title}}** online, no account needed.{{#expires}}\n\nThis link is personal to you and expires on {{expires}}.{{/expires}}",
                    'button' => 'Review & {{action}}',
                ],
            ],
            'signature-reminder' => [
                'name' => 'Signature reminder',
                'category' => 'Signatures',
                'when' => 'Sent to nudge a recipient whose signature is still outstanding.',
                'variables' => $common + [
                    'sender' => 'Who sent the request, when known',
                    'name' => "The recipient's first name, when known",
                    'expires' => 'The expiry date, when the request has one',
                ],
                'sample' => ['title' => 'Engagement letter.pdf', 'sender' => 'Vernon Francis', 'name' => 'Dana', 'expires' => '30 Sep 2026'],
                'copy' => [
                    'subject' => 'Reminder: {{title}} still needs your signature',
                    'preheader' => 'A document is still waiting for your signature.',
                    'eyebrow' => 'Reminder',
                    'greeting' => self::HI,
                    'title' => 'A quick reminder',
                    'lead' => '{{title}} is still waiting for your signature{{#sender}}, sent by {{sender}}{{/sender}}.',
                    'body' => '{{#expires}}This link expires on {{expires}}.{{/expires}}',
                    'button' => 'Review & sign',
                ],
            ],
            'signature-completed' => [
                'name' => 'Document signed',
                'category' => 'Signatures',
                'when' => 'Sent to everyone on the request once the last signature lands.',
                'variables' => $common + [
                    'name' => "The recipient's first name, when known",
                    'signers' => 'Who signed, as a list of names',
                    'attached' => 'Whether the signed copy is attached to this email',
                ],
                'sample' => ['title' => 'Engagement letter.pdf', 'name' => 'Dana', 'signers' => 'Dana Reed, Vernon Francis', 'attached' => true],
                'copy' => [
                    'subject' => 'Signed: {{title}}',
                    'preheader' => 'Everyone has now signed the document.',
                    'eyebrow' => 'Signed',
                    'greeting' => self::HI,
                    'title' => 'Your document is signed',
                    'lead' => 'Everyone has now signed {{title}}.',
                    'body' => "{{#signers}}Signed by: {{signers}}.\n\n{{/signers}}{{#attached}}The signed copy is attached to this email for your records.{{/attached}}{{^attached}}We're still preparing the signed copy, it'll follow shortly.{{/attached}}",
                    'button' => 'View in Signatures',
                ],
            ],
            'signature-declined' => [
                'name' => 'Signature declined',
                'category' => 'Signatures',
                'when' => 'Sent to the sender when a recipient declines. The reason rides along as a callout.',
                'variables' => $common + ['by' => 'Who declined, when known'],
                'sample' => ['title' => 'Engagement letter.pdf', 'by' => 'Dana Reed'],
                'sampleExtras' => ['quote' => 'The figures in section 2 are out of date.'],
                'copy' => [
                    'subject' => '{{title}} was declined',
                    'preheader' => 'A signature request was declined.',
                    'eyebrow' => 'Signature',
                    'title' => 'A signature was declined',
                    'lead' => '{{title}} was declined{{#by}} by {{by}}{{/by}}. Nobody else can sign it now.',
                    'button' => 'Open Signatures',
                ],
            ],
            'signature-changes-requested' => [
                'name' => 'Changes requested',
                'category' => 'Signatures',
                'when' => 'Sent to the sender when a reviewer asks for changes before approving. Their comment rides along as a callout.',
                'variables' => $common + ['by' => 'Who asked for changes, when known'],
                'sample' => ['title' => 'Engagement letter.pdf', 'by' => 'Dana Reed'],
                'sampleExtras' => ['quote' => 'Please correct the client name on page 1.'],
                'copy' => [
                    'subject' => 'Changes requested on {{title}}',
                    'preheader' => 'A reviewer asked for changes before approving.',
                    'eyebrow' => 'Signature',
                    'title' => 'Changes were requested',
                    'lead' => '{{title}} was reviewed{{#by}} by {{by}}{{/by}}, who asked for changes before approving.',
                    'body' => 'The request is on hold until you revise and resend it.',
                    'button' => 'Open Signatures',
                ],
            ],
        ];
    }

    private static function invitations(): array
    {
        $name = ['name' => "The recipient's first name, when known"];
        $url = ['url' => 'Where the button goes'];
        $inviter = ['inviter' => 'Who sent the invitation, when known'];
        $lead = '{{#inviter}}{{inviter}} has added you{{/inviter}}{{^inviter}}You have been added{{/inviter}} to the {{site}} portal.';
        $staffLead = '{{#inviter}}{{inviter}} has invited you{{/inviter}}{{^inviter}}You have been invited{{/inviter}} to join {{site}} on the portal.';
        $clientBody = 'Through the portal you can reach your bookings, events, files, documents, contracts, invoices and updates, all in one place.';
        $staffBody = 'The portal is where the team works with clients, files, documents, signatures, calendars, messages and email in one place.';

        return [
            'client-invite' => [
                'name' => 'Client invitation',
                'category' => 'Invitations',
                'when' => 'Sent when a client with no portal account yet is invited.',
                'variables' => $name + $url + $inviter,
                'sample' => ['name' => 'Chen', 'inviter' => 'Vernon Francis'],
                'sampleExtras' => ['details' => [['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => 'You have been invited to the {{site}} portal',
                    'preheader' => "Create your account to see the files we're working on together.",
                    'eyebrow' => "You're invited",
                    'greeting' => self::HELLO,
                    'title' => 'Connect to your files',
                    'lead' => $lead,
                    'body' => $clientBody."\n\nCreating your account links it to your existing records with us automatically.",
                    'button' => 'Create your account',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'client-invite-existing' => [
                'name' => 'Client invitation (has an account)',
                'category' => 'Invitations',
                'when' => 'Sent when the invited client already signs in with this email address.',
                'variables' => $name + $url + $inviter,
                'sample' => ['name' => 'Chen', 'inviter' => 'Vernon Francis'],
                'sampleExtras' => ['details' => [['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => 'You have been invited to the {{site}} portal',
                    'preheader' => 'Sign in to accept your invitation to the portal.',
                    'eyebrow' => "You're invited",
                    'greeting' => self::HELLO,
                    'title' => 'Accept your invitation',
                    'lead' => $lead,
                    'body' => $clientBody."\n\nYou already have an account with this email address, so just sign in and the invitation will be added to it.",
                    'button' => 'Sign in and accept',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'client-invite-reminder' => [
                'name' => 'Client invitation reminder',
                'category' => 'Invitations',
                'when' => 'Sent when a client invitation is still waiting to be accepted.',
                'variables' => $name + $url,
                'sample' => ['name' => 'Chen'],
                'sampleExtras' => ['details' => [['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => 'Reminder: your {{site}} invitation is waiting',
                    'preheader' => 'Your invitation is still waiting, it takes about a minute.',
                    'greeting' => self::HELLO,
                    'title' => 'Your invitation is still waiting',
                    'lead' => 'Setting up your account takes about a minute.',
                    'body' => 'A little while ago we invited you to connect to your files with {{site}}. Your secure space is ready whenever you are.',
                    'button' => 'Finish setting up',
                ],
            ],
            'staff-invite' => [
                'name' => 'Staff invitation',
                'category' => 'Invitations',
                'when' => 'Sent when a new staff member with no account yet is invited to join the team.',
                'variables' => $name + $url + $inviter,
                'sample' => ['name' => 'Dana', 'inviter' => 'Vernon Francis'],
                'sampleExtras' => ['details' => [['Role', 'Reviewing Officer'], ['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => 'You have been invited to join {{site}}',
                    'preheader' => 'Set up your account to get started.',
                    'eyebrow' => "You're invited",
                    'greeting' => self::HELLO,
                    'title' => 'Join the {{site}} team',
                    'lead' => $staffLead,
                    'body' => $staffBody."\n\nUse the button below to set up your account and choose a password.",
                    'button' => 'Set up your account',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'staff-invite-existing' => [
                'name' => 'Staff invitation (has an account)',
                'category' => 'Invitations',
                'when' => 'Sent when the invited staff member already signs in with this email address.',
                'variables' => $name + $url + $inviter,
                'sample' => ['name' => 'Dana', 'inviter' => 'Vernon Francis'],
                'sampleExtras' => ['details' => [['Role', 'Reviewing Officer'], ['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => 'You have been invited to join {{site}}',
                    'preheader' => 'Set up your account to get started.',
                    'eyebrow' => "You're invited",
                    'greeting' => self::HELLO,
                    'title' => 'Join the {{site}} team',
                    'lead' => $staffLead,
                    'body' => $staffBody."\n\nYou already have an account with this email address, so just sign in and your new access will be added to it.",
                    'button' => 'Sign in and accept',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'invitation-accepted' => [
                'name' => 'Invitation accepted',
                'category' => 'Invitations',
                'when' => 'Sent to the inviter once the person they invited joins.',
                'variables' => [
                    'name' => "The inviter's name",
                    'who' => 'Who accepted',
                    'whatFor' => 'What they now have access to',
                    'url' => 'Where the button goes',
                ],
                'sample' => ['name' => 'Vernon', 'who' => 'Chen Wei', 'whatFor' => 'their client files'],
                'copy' => [
                    'subject' => '{{who}} has joined the portal',
                    'preheader' => 'Your invitation was accepted.',
                    'eyebrow' => 'Invitation accepted',
                    'greeting' => 'Hello {{name}},',
                    'title' => '{{who}} has joined',
                    'lead' => '{{who}} accepted their invitation and now has access to {{whatFor}}.',
                    'button' => 'Open the portal',
                ],
            ],
        ];
    }

    private static function companies(): array
    {
        $vars = [
            'name' => "The recipient's first name, when known",
            'company' => "The company's name",
            'url' => 'Where the button goes',
            'isProvider' => 'Whether the company is a CIP service provider',
        ];
        $eyebrow = '{{#isProvider}}Service provider access{{/isProvider}}{{^isProvider}}Company access{{/isProvider}}';
        $explainer = '{{#isProvider}}On the portal you can view and work on Citizenship by Investment applications filed by {{company}}, including documents, comments and status updates, according to the permissions for your role.{{/isProvider}}'
            ."{{^isProvider}}On the portal you can reach {{company}}'s files, documents and updates, according to the permissions for your role.{{/isProvider}}";

        return [
            'company-member-invite' => [
                'name' => 'Company invitation',
                'category' => 'Companies',
                'when' => 'Sent when someone with no account yet is invited to join a company on the portal.',
                'variables' => $vars + ['role' => 'Their role at the company', 'inviter' => 'Who invited them, when known'],
                'sample' => ['name' => 'Priya', 'company' => 'Galaxy Consultants', 'role' => 'Manager', 'inviter' => 'Vernon Francis', 'isProvider' => true],
                'sampleExtras' => ['details' => [['Company', 'Galaxy Consultants'], ['Your role', 'Manager'], ['Invited by', 'Vernon Francis'], ['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => "You're invited to join {{company}} on {{site}}",
                    'preheader' => 'Create your account to join {{company}} on the portal.',
                    'eyebrow' => $eyebrow,
                    'greeting' => self::HELLO,
                    'title' => "You're invited to join {{company}}",
                    'lead' => '{{#inviter}}{{inviter}} has invited you{{/inviter}}{{^inviter}}You have been invited{{/inviter}} to join {{company}} as {{role}}.',
                    'body' => $explainer."\n\nUse the button below to create your account and choose a password. Once you have, you can sign in and start work.",
                    'button' => 'Create your account',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'company-member-invite-existing' => [
                'name' => 'Company invitation (has an account)',
                'category' => 'Companies',
                'when' => 'Sent when the invited person already signs in with this email address.',
                'variables' => $vars + ['role' => 'Their role at the company', 'inviter' => 'Who invited them, when known'],
                'sample' => ['name' => 'Priya', 'company' => 'Galaxy Consultants', 'role' => 'Manager', 'inviter' => 'Vernon Francis', 'isProvider' => true],
                'sampleExtras' => ['details' => [['Company', 'Galaxy Consultants'], ['Your role', 'Manager'], ['Invited by', 'Vernon Francis'], ['Expires', '30 Sep 2026, 5:00 PM']]],
                'copy' => [
                    'subject' => "You're invited to join {{company}} on {{site}}",
                    'preheader' => 'Sign in to accept your invitation to {{company}}.',
                    'eyebrow' => $eyebrow,
                    'greeting' => self::HELLO,
                    'title' => "You're invited to join {{company}}",
                    'lead' => '{{#inviter}}{{inviter}} has invited you{{/inviter}}{{^inviter}}You have been invited{{/inviter}} to join {{company}} as {{role}}.',
                    'body' => $explainer."\n\nYou already have an account with this email address. Sign in to accept the invitation — {{company}} will be added to your existing access.",
                    'button' => 'Sign in and accept',
                    'footNote' => self::IGNORE_NOTE,
                ],
            ],
            'company-member-added' => [
                'name' => 'Added to a company',
                'category' => 'Companies',
                'when' => 'Sent when an existing account is added to a company without needing an invitation.',
                'variables' => $vars + ['role' => 'Their role at the company', 'addedBy' => 'Who added them, when known'],
                'sample' => ['name' => 'Priya', 'company' => 'Galaxy Consultants', 'role' => 'Manager', 'addedBy' => 'Vernon Francis', 'isProvider' => true],
                'sampleExtras' => ['details' => [['Company', 'Galaxy Consultants'], ['Your role', 'Manager'], ['Added by', 'Vernon Francis']]],
                'copy' => [
                    'subject' => 'You now have access to {{company}} on {{site}}',
                    'preheader' => '{{#addedBy}}{{addedBy}} added you to {{company}}.{{/addedBy}}{{^addedBy}}You have been added to {{company}}.{{/addedBy}}',
                    'eyebrow' => $eyebrow,
                    'greeting' => self::HELLO,
                    'title' => 'You have been added to {{company}}',
                    'lead' => '{{#addedBy}}{{addedBy}} has added you{{/addedBy}}{{^addedBy}}You have been added{{/addedBy}} to {{company}} as {{role}}.',
                    'body' => "Your access is already active — you do not need to accept an invitation.\n\n".$explainer."\n\nSign in to the portal to see what you now have access to.",
                    'button' => 'Open the portal',
                    'footNote' => "If you weren't expecting this change, contact us at support@tmantoine.com.",
                ],
            ],
            'company-member-removed' => [
                'name' => 'Removed from a company',
                'category' => 'Companies',
                'when' => "Sent when someone's access to a company is taken away.",
                'variables' => $vars + ['removedBy' => 'Who removed them, when known'],
                'sample' => ['name' => 'Priya', 'company' => 'Galaxy Consultants', 'removedBy' => 'Vernon Francis', 'isProvider' => true],
                'sampleExtras' => ['details' => [['Company', 'Galaxy Consultants'], ['Removed by', 'Vernon Francis']]],
                'copy' => [
                    'subject' => 'Your access to {{company}} has been removed',
                    'preheader' => 'You no longer have access to {{company}} on the {{site}} portal.',
                    'eyebrow' => 'Access update',
                    'greeting' => self::HELLO,
                    'title' => 'Your access to {{company}} has been removed',
                    'lead' => '{{#removedBy}}{{removedBy}} has removed you{{/removedBy}}{{^removedBy}}You have been removed{{/removedBy}} from {{company}} on the {{site}} portal.',
                    'body' => "You received this email because your access to {{#isProvider}}{{company}}'s applications, files and updates{{/isProvider}}{{^isProvider}}{{company}}'s files, documents and updates{{/isProvider}} through the portal has ended.\n\nYour personal account is unchanged. You can still sign in if you have other access. If this was a mistake, ask the person who manages {{company}} to restore it, or contact us at support@tmantoine.com.",
                    'button' => 'Sign in to the portal',
                    'footNote' => 'This is an automated notice from {{site}}.',
                ],
            ],
        ];
    }

    private static function clients(): array
    {
        return [
            'staff-assigned-to-client' => [
                'name' => 'Assigned to a client',
                'category' => 'Clients',
                'when' => 'Sent to a staff member when a client is assigned to them.',
                'variables' => [
                    'name' => "The staff member's name",
                    'client' => "The client's name",
                    'assigner' => 'Who made the assignment, when known',
                    'url' => 'Where the button goes',
                ],
                'sample' => ['name' => 'Dana Reed', 'client' => 'Chen Wei', 'assigner' => 'Vernon Francis'],
                'sampleExtras' => ['details' => [['Client', 'Chen Wei'], ['Your role', 'Primary advisor']]],
                'copy' => [
                    'subject' => 'You have been assigned to {{client}}',
                    'preheader' => 'A client has been assigned to you.',
                    'eyebrow' => 'Client assignment',
                    'greeting' => 'Hello {{name}},',
                    'title' => 'You are now working with {{client}}',
                    'lead' => '{{#assigner}}{{assigner}} assigned you{{/assigner}}{{^assigner}}You have been assigned{{/assigner}} to {{client}}.',
                    'button' => 'Open the client',
                ],
            ],
            'client-staff-assigned' => [
                'name' => 'Your point of contact',
                'category' => 'Clients',
                'when' => 'Sent to a client when a staff member becomes their contact.',
                'variables' => [
                    'name' => "The client's first name, when known",
                    'staff' => "The staff member's name",
                    'url' => 'Where the button goes',
                ],
                'sample' => ['name' => 'Chen', 'staff' => 'Dana Reed'],
                'sampleExtras' => ['details' => [['Contact', 'Dana Reed'], ['Role', 'Senior Advisor']]],
                'copy' => [
                    'subject' => '{{staff}} is now your contact at {{site}}',
                    'preheader' => 'Say hello to your point of contact.',
                    'eyebrow' => 'Your team',
                    'greeting' => self::HELLO,
                    'title' => 'Meet your point of contact',
                    'lead' => '{{staff}} will be looking after your work with {{site}}.',
                    'body' => 'You can reach them through the portal at any time, messages, files and updates all stay in one place.',
                    'button' => 'Open the portal',
                ],
            ],
        ];
    }

    private static function files(): array
    {
        return [
            'file-shared' => [
                'name' => 'File shared',
                'category' => 'Files',
                'when' => 'Sent when someone shares a file or folder. A note they typed rides along as a callout.',
                'variables' => [
                    'sharer' => 'Who shared it',
                    'item' => "The file or folder's name",
                    'what' => 'Either "a file" or "a folder"',
                    'kind' => 'Either "document" or "folder"',
                    'url' => 'Where the button goes',
                ],
                'sample' => ['sharer' => 'Dana Reed', 'item' => 'Contract draft.pdf', 'what' => 'a file', 'kind' => 'document'],
                'sampleExtras' => ['files' => [['Contract draft.pdf', 'File']], 'quote' => 'Latest version with your edits folded in.'],
                'copy' => [
                    'subject' => '{{sharer}} shared {{what}} with you',
                    'preheader' => 'A new {{kind}} is waiting for you in the portal.',
                    'title' => '{{sharer}} shared {{what}} with you',
                    'lead' => "It's ready for you in your space.",
                    'button' => 'View in the portal',
                ],
            ],
            'file-request' => [
                'name' => 'Document request',
                'category' => 'Files',
                'when' => 'Sent when someone is asked to upload documents through a secure link. The message typed on the request rides along as a callout.',
                'variables' => [
                    'title' => "The request's title",
                    'requester' => 'Who is asking',
                    'name' => "The recipient's first name, when known",
                    'url' => 'Where the button goes',
                ],
                'sample' => ['title' => '2026 tax documents', 'requester' => 'Dana Reed', 'name' => 'Chen'],
                'sampleExtras' => ['quote' => 'Passport and proof of address, please.', 'details' => [['Due', '30 Sep 2026']]],
                'copy' => [
                    'subject' => '{{requester}} asked you for documents',
                    'preheader' => '{{title}}, upload securely, no account needed.',
                    'eyebrow' => 'Document request',
                    'greeting' => self::HI,
                    'title' => '{{requester}} asked you for documents',
                    'lead' => '{{title}}',
                    'body' => "Use the button below to upload your files securely. You don't need an account, and the link only lets you add files, nothing else in the workspace is visible.",
                    'button' => 'Upload your files',
                ],
            ],
            'file-request-received' => [
                'name' => 'Documents arrived',
                'category' => 'Files',
                'when' => 'Sent to the requester when files come in through one of their links.',
                'variables' => [
                    'title' => "The request's title",
                    'what' => 'What arrived: "A file" or "3 files"',
                    'whatLower' => 'The same, mid-sentence: "a file" or "3 files"',
                    'from' => 'Who uploaded, when known',
                    'name' => "The requester's first name, when known",
                    'url' => 'Where the button goes',
                ],
                'sample' => ['title' => '2026 tax documents', 'what' => '2 files', 'whatLower' => '2 files', 'from' => 'Chen Wei', 'name' => 'Dana'],
                'copy' => [
                    'subject' => '{{what}} arrived for “{{title}}”',
                    'preheader' => '{{what}} just came in through your document request.',
                    'eyebrow' => 'Document request',
                    'greeting' => self::HI,
                    'title' => '{{what}} arrived',
                    'lead' => '{{#from}}{{from}} uploaded {{/from}}{{^from}}Someone uploaded {{/from}}{{whatLower}} to “{{title}}”.',
                    'button' => 'Open the folder',
                ],
            ],
        ];
    }

    private static function messages(): array
    {
        $vars = [
            'from' => 'Who the unread message is from',
            'url' => 'Where the button goes',
        ];

        return [
            'message-reminder-1' => [
                'name' => 'Unread message (1 hour)',
                'category' => 'Messages',
                'when' => 'Sent when a portal message has sat unread for about an hour. A preview of it rides along as a callout.',
                'variables' => $vars,
                'sample' => ['from' => 'Dana Reed'],
                'sampleExtras' => ['quote' => 'Hi Chen — the documents are ready for your review.'],
                'copy' => [
                    'subject' => 'You have a new message from {{from}}',
                    'preheader' => 'Your message from {{from}} is still unread.',
                    'title' => 'You have a new message',
                    'lead' => "{{from}} sent you a message about an hour ago and it's still unread.",
                    'button' => 'Read the message',
                ],
            ],
            'message-reminder-2' => [
                'name' => 'Unread message (next day)',
                'category' => 'Messages',
                'when' => 'The second nudge, sent when the message is still unread the next working day.',
                'variables' => $vars,
                'sample' => ['from' => 'Dana Reed'],
                'sampleExtras' => ['quote' => 'Hi Chen — the documents are ready for your review.'],
                'copy' => [
                    'subject' => 'Still waiting to hear from you',
                    'preheader' => 'Your message from {{from}} is still unread.',
                    'eyebrow' => 'Reminder',
                    'title' => 'Still waiting to hear from you',
                    'lead' => "We reached out and haven't heard back. Your message is still waiting in the portal.",
                    'button' => 'Read and reply',
                ],
            ],
            'message-reminder-3' => [
                'name' => 'Unread message (final)',
                'category' => 'Messages',
                'when' => 'The last nudge, sent a full day after the message arrived.',
                'variables' => $vars,
                'sample' => ['from' => 'Dana Reed'],
                'sampleExtras' => ['quote' => 'Hi Chen — the documents are ready for your review.'],
                'copy' => [
                    'subject' => 'A message from us is still waiting for you',
                    'preheader' => 'Your message from {{from}} is still unread.',
                    'eyebrow' => 'Final reminder',
                    'title' => 'A message from us is still waiting for you',
                    'lead' => "It's been a full day and we still haven't heard back, here's one last reminder.",
                    'body' => "If now isn't a good time, no problem, the message will be waiting whenever you're ready.",
                    'button' => 'Open the conversation',
                ],
            ],
            'team-added' => [
                'name' => 'Added to a team',
                'category' => 'Messages',
                'when' => 'Sent when someone is added to a team.',
                'variables' => [
                    'addedBy' => 'Who added them',
                    'team' => "The team's name",
                    'url' => 'Where the button goes',
                ],
                'sample' => ['addedBy' => 'Vernon Francis', 'team' => 'Client Onboarding'],
                'copy' => [
                    'subject' => 'You were added to {{team}}',
                    'preheader' => '{{addedBy}} added you to a team in the portal.',
                    'eyebrow' => 'Teams',
                    'title' => 'You were added to {{team}}',
                    'lead' => '{{addedBy}} added you to a team in the portal.',
                    'body' => "You can now see the team's shared files, calendar and conversations, and reach everyone on it in one place.",
                    'button' => 'Open the team',
                ],
            ],
        ];
    }

    private static function calendar(): array
    {
        $vars = [
            'title' => "The event's title",
            'name' => "The recipient's first name, when known",
            'organizer' => "The organizer's name, when known",
            'url' => 'Where the button goes',
        ];
        $sample = ['title' => 'Quarterly review', 'name' => 'Chen', 'organizer' => 'Dana Reed'];
        $details = ['details' => [['When', 'Tue 15 Sep 2026, 10:00 AM'], ['Where', 'Boardroom 2'], ['Organizer', 'Dana Reed']]];

        return [
            'calendar-invitation' => [
                'name' => 'Event invitation',
                'category' => 'Calendar',
                'when' => 'Sent when someone is invited to an event. Its description rides along as a callout.',
                'variables' => $vars,
                'sample' => $sample,
                'sampleExtras' => $details,
                'copy' => [
                    'subject' => 'Invitation: {{title}}',
                    'eyebrow' => 'Calendar',
                    'greeting' => self::HI,
                    'title' => '{{#organizer}}{{organizer}} invited you to {{title}}{{/organizer}}{{^organizer}}You have been invited to {{title}}{{/organizer}}',
                    'lead' => 'Here are the details.',
                    'button' => 'Open in the portal',
                ],
            ],
            'calendar-updated' => [
                'name' => 'Event updated',
                'category' => 'Calendar',
                'when' => 'Sent to attendees when an event changes.',
                'variables' => $vars + ['changes' => 'What changed, as a list'],
                'sample' => $sample + ['changes' => 'time, location'],
                'sampleExtras' => $details,
                'copy' => [
                    'subject' => 'Updated: {{title}}',
                    'eyebrow' => 'Calendar',
                    'greeting' => self::HI,
                    'title' => '{{title}} has changed',
                    'lead' => '{{#organizer}}{{organizer}} updated this event.{{/organizer}}{{^organizer}}This event was updated.{{/organizer}}',
                    'body' => '{{#changes}}**What changed:** {{changes}}{{/changes}}',
                    'button' => 'Open in the portal',
                ],
            ],
            'calendar-cancelled' => [
                'name' => 'Event cancelled',
                'category' => 'Calendar',
                'when' => 'Sent to attendees when an event is cancelled.',
                'variables' => $vars,
                'sample' => $sample,
                'sampleExtras' => $details,
                'copy' => [
                    'subject' => 'Cancelled: {{title}}',
                    'eyebrow' => 'Calendar',
                    'greeting' => self::HI,
                    'title' => '{{title}} was cancelled',
                    'lead' => '{{#organizer}}{{organizer}} cancelled this event.{{/organizer}}{{^organizer}}This event was cancelled.{{/organizer}} It has been taken off your calendar.',
                    'button' => 'Open your calendar',
                ],
            ],
            'calendar-response' => [
                'name' => 'Invitation response',
                'category' => 'Calendar',
                'when' => 'Sent to the organizer when an attendee responds.',
                'variables' => $vars + [
                    'attendee' => 'Who responded',
                    'response' => 'How they responded ("accepted")',
                ],
                'sample' => $sample + ['attendee' => 'Chen Wei', 'response' => 'accepted'],
                'sampleExtras' => $details,
                'copy' => [
                    'subject' => '{{attendee}} {{response}}: {{title}}',
                    'eyebrow' => 'Calendar',
                    'greeting' => self::HI,
                    'title' => '{{attendee}} {{response}}',
                    'lead' => '{{attendee}} {{response}} your invitation to {{title}}.',
                    'button' => 'See all responses',
                ],
            ],
        ];
    }

    private static function cip(): array
    {
        $vars = [
            'number' => 'Application number, or CIP application number once assigned',
            'applicant' => "Main applicant's name",
            'provider' => 'Service provider',
            'recipient' => 'First name of the person this copy is addressed to, when known',
        ];
        $when = 'The subject keeps the §22 filing format and is not editable here.';
        $sample = ['number' => 'GAL26-00001', 'applicant' => 'Chen Wei', 'provider' => 'Galaxy Consultants', 'recipient' => 'Priya'];
        $details = ['details' => [['Application', 'GAL26-00001'], ['Applicant', 'Chen Wei'], ['Service provider', 'Galaxy Consultants']]];

        // The plain status-change notice, one template per §22 status so each
        // stage can be worded on its own. Shipped copy is identical for all
        // of them; the point of the split is that an edit to one stage's
        // email leaves the others alone. Postcards::cipStatus picks
        // cip-status-<status> and falls back to cip-status.
        $statusCopy = [
            'preheader' => '{{number}} now stands at {{status}}.',
            'eyebrow' => 'CIP Applications',
            'greeting' => self::CIP_HI,
            'title' => '{{number}}: {{status}}',
            'lead' => '{{applicant}}’s application now stands at {{status}}.',
            'body' => '{{applicant}}’s Citizenship by Investment application with {{provider}} is now at **{{status}}**. Open the application in the portal for the current checklist, comments and next step.',
            'button' => 'Open the application',
            'footNote' => self::CIP_FOOT,
        ];
        $statusBodies = [
            'cip-status-new' => 'This file has been registered. A reviewing officer will be assigned next. You do not need to send anything further unless you are asked.',
            'cip-status-assessment-feedback' => 'The reviewing officer is assessing each document on {{applicant}}’s file. You will be emailed separately if any document needs an update.',
            'cip-status-pending-review' => 'The original package has gone to the Unit. {{applicant}}’s file now waits for their review. You do not need to resubmit unless the Unit asks for more.',
            'cip-status-background-check' => 'The Unit has accepted {{applicant}}’s file for processing. A background check is underway. There is nothing to upload unless you are asked.',
            'cip-status-post-approval' => 'We are ready for Stage 1 of the post-approval process: applying for the Certificate of Registration (COR). The Citizenship by Investment Unit requires **soft copies only**.

Please upload:

1. **Oath of Allegiance** (required, 16 years and over) — signed by the applicant and a Notary or Attorney-at-Law, whose name must be clearly legible, and stamped. The date on the Oath cannot be before the granted date.
2. **Proof of Payment of the Qualifying Investment** (required) — as set out in the Notification Letter. Forward it to T.M. Antoine Partners Advisory.
3. **One digital passport-sized photo** (required) — 2 inch × 2 inch.
4. **Letter of Confirmation** (optional, Real Estate applicants only).
5. **Sales and Purchase Agreement** (optional, Real Estate applicants only).
6. **Escrow Agreement** (optional, Real Estate applicants only).

Documents not written in English MUST be translated. The translation must be original, signed and stamped by a Notary or Attorney-at-Law. A certified true copy of the credentials of the translator, Notary and/or Attorney-at-Law who certified or translated any of those documents must also be provided.

Open the application in the portal to upload the COR documents.',
            'cip-status-pending-cor' => 'The Certificate of Registration package for {{applicant}} has been submitted. The file now waits for the COR. You do not need to send anything further unless you are asked.',
            'cip-status-apply-for-nic' => 'The Certificate of Registration has been received. Stage 2 is applying for the National Insurance Card (NIC). The National Insurance Corporation requires **soft copies only**. Send one PDF for each family member aged 16 and over, documents in the listed order. Open the application to upload them on each person’s Documents tab.',
            'cip-status-pending-nic' => 'The NIC application for {{applicant}} has been submitted. The file now waits for the National Insurance Card. You do not need to send anything further unless you are asked.',
            'cip-status-apply-for-passport' => 'The National Insurance Card has been received. Stage 3 is applying for the passport. The passport office accepts **hard copy original documents only**. Track scans on each person’s Documents tab, then send the physical copies to T.M. Antoine Partners by courier: TaylorMarc Court, Rodney Bay, Gros Islet, Saint Lucia.

Please send:

1. **Completed ePP Form** (required) — the applicant signs the SIGNATURE BOX and Section 12. Section 13 is signed and stamped by a Notary or Attorney-at-Law.
2. **Original Birth Certificate** (required) — the original, or a certified copy from the issuing authority.
3. **Certified copy of passport bio data page** (required).
4. **Original Marriage Certificate** (married women).
5. **Original Divorce Certificate** (divorced women).
6. **Original translations** of documents not originally in English — the Passport Office will not accept copies previously provided.
7. **Four physical passport-sized photos** (required) — 2 inch × 2 inch, one certified on the back.

Children receive a passport and owe the same originals except marriage and divorce certificates. There is no sponsor checklist at this stage.',
            'cip-status-pending-passport' => 'The passport application for {{applicant}} has been submitted. The file now waits for the passport. You do not need to send anything further unless you are asked.',
            'cip-status-ready-for-delivery' => 'The passport for {{applicant}} has been received and the file is ready for delivery. Arrange collection or courier with T.M. Antoine Partners.',
            'cip-status-closed' => 'The passport has been delivered. {{applicant}}’s file is closed. No further documents can be uploaded on this application.',
        ];
        $statuses = [];
        foreach ([
            'cip-status-new' => ['New Application', 'New Applications', 'Sent when a file is registered as a new application.'],
            'cip-status-assessment-feedback' => ['Assessment Feedback', 'Assessment Feedback', 'Sent when a file moves to Assessment Feedback.'],
            'cip-status-pending-review' => ['Pending Review', 'Pending Review', 'Sent when a file moves to Pending Review.'],
            'cip-status-background-check' => ['Background Check', 'Background Check', 'Sent when a file moves to Background Check.'],
            'cip-status-post-approval' => ['Post-Approval', 'Post-Approval', 'Sent when an approved file is moved to Post-Approval and Stage 1 COR documents are requested.'],
            'cip-status-pending-cor' => ['Pending COR', 'Pending COR', 'Sent when the COR package is submitted and the file waits for the Certificate of Registration.'],
            'cip-status-apply-for-nic' => ['Apply for NIC', 'Apply for NIC', 'Sent when the COR has been received and Stage 2 (NIC) begins.'],
            'cip-status-pending-nic' => ['Pending NIC', 'Pending NIC', 'Sent when the NIC application is submitted and the file waits for the card.'],
            'cip-status-apply-for-passport' => ['Apply for Passport', 'Apply for Passport', 'Sent when the NIC has been received and Stage 3 (passport) begins.'],
            'cip-status-pending-passport' => ['Pending Passport', 'Pending Passport', 'Sent when the passport application is submitted and the file waits for the passport.'],
            'cip-status-ready-for-delivery' => ['Ready for Delivery', 'Ready for Delivery', 'Sent when the passport has been received and is ready to deliver.'],
            'cip-status-closed' => ['File Closed', 'Closed', 'Sent when the passport has been delivered and the file is closed.'],
        ] as $key => [$name, $label, $moment]) {
            $statuses[$key] = [
                'name' => $name,
                'category' => 'CIP Applications',
                'when' => $moment.' '.$when,
                'variables' => $vars + ['status' => 'The new status'],
                'sample' => $sample + ['status' => $label],
                'sampleExtras' => $details,
                'copy' => array_merge($statusCopy, ['body' => $statusBodies[$key]]),
            ];
        }

        return [
            'cip-assigned' => [
                'name' => 'Application assigned',
                'category' => 'CIP Applications',
                'when' => 'Sent when a file is handed to a reviewing officer. '.$when,
                'variables' => $vars + ['status' => "The application's status"],
                'sample' => $sample + ['status' => 'Review Application'],
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}}: {{applicant}} is now at {{status}}.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => '{{number}} is in review',
                    'lead' => '{{number}} stands at {{status}}.',
                    'body' => 'This Citizenship by Investment file has been assigned for review. Open the application to begin the document assessment for {{applicant}} ({{provider}}).',
                    'button' => 'Open the application',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-updates-required' => [
                'name' => 'Updates required',
                'category' => 'CIP Applications',
                'when' => 'Sent to the provider side when documents are sent back with notes. '.$when,
                'variables' => $vars + [
                    'docsNeed' => 'How many documents need an update ("2 documents need")',
                    'sent' => 'How many were sent back, mid-sentence ("one back", "3 back")',
                    'documents' => 'The list of documents sent back, each with its reason',
                ],
                'sample' => $sample + [
                    'docsNeed' => '2 documents need',
                    'sent' => '2 back',
                    'documents' => new HtmlString('<ul><li><strong>Passport bio page</strong>, the copy is not certified.</li><li><strong>Bank reference</strong>, older than six months.</li></ul>'),
                ],
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}}: {{docsNeed}} an update.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => 'Updates required on {{number}}',
                    'lead' => 'The reviewing officer has assessed {{applicant}}’s documents and sent {{sent}} with notes.',
                    'body' => "Please replace or re-upload each item below. The reviewing officer's reason is next to the document name.\n\n{{documents}}",
                    'button' => 'Open the documents',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-ready-to-submit' => [
                'name' => 'Ready to submit',
                'category' => 'CIP Applications',
                'when' => 'Sent to the provider side when every required document is accepted. '.$when,
                'variables' => $vars,
                'sample' => $sample,
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}} is ready to submit, confirm to lock the original package.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => '{{number}} is ready to submit',
                    'lead' => 'Assessment feedback is complete, {{applicant}}’s file is ready to submit. Confirm submission to lock the original package.',
                    'body' => 'Every required document on {{applicant}}’s file ({{provider}}) has been accepted. Confirm submission to lock the original package. After that, the originals cannot be replaced; further Unit requests go through Additional Documents.',
                    'button' => 'Confirm submission',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-apply-for-cor' => [
                'name' => 'Apply for COR',
                'category' => 'CIP Applications',
                'when' => 'Sent to the provider side when every Stage 1 Certificate of Registration document is accepted. '.$when,
                'variables' => $vars,
                'sample' => $sample,
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}} is ready to apply for the COR, confirm to lock the Certificate of Registration package.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => '{{number}} is ready to apply for the COR',
                    'lead' => 'Every required Certificate of Registration document on {{applicant}}’s file is ready. Confirm submission to lock the COR package.',
                    'body' => 'Every required COR document on {{applicant}}’s file ({{provider}}) has been accepted. Confirm submission to lock the Certificate of Registration package. After that, those documents cannot be replaced. Additional Documents stays open for anything the Unit asks later.',
                    'button' => 'Confirm submission',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-non-compliant' => [
                'name' => 'Non-compliant',
                'category' => 'CIP Applications',
                'when' => 'Sent to the provider side when the Unit asks for more. '.$when,
                'variables' => $vars,
                'sample' => $sample,
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}} is non-compliant, the Unit has requested additional information.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => '{{number}} is non-compliant',
                    'lead' => 'The Unit has requested additional information on {{applicant}}’s file. Upload the required documents through Additional Documents.',
                    'body' => 'Use Additional Documents on {{applicant}}’s application ({{provider}}). Do not replace files in the original submission package.',
                    'button' => 'Open Additional Documents',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-delayed' => [
                'name' => 'Application delayed',
                'category' => 'CIP Applications',
                'when' => 'Sent by the daily check when a file has waited too long with no decision. '.$when,
                'variables' => $vars + ['days' => 'How many days have passed'],
                'sample' => $sample + ['days' => '180'],
                'sampleExtras' => $details,
                'copy' => [
                    'preheader' => '{{number}} is delayed, {{days}} days with no decision.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => self::CIP_HI,
                    'title' => '{{number}} is delayed',
                    'lead' => '{{days}} days have passed since {{applicant}}’s file was accepted for processing, and no decision has been recorded.',
                    'body' => 'Please review {{applicant}}’s file with {{provider}} and follow up with the Unit. The application stays open until a decision is recorded.',
                    'button' => 'Open the application',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
            'cip-decision' => [
                // Named so a reader scanning for "granted" or "denied" finds
                // the one email that sends for both.
                'name' => 'Decision — granted or denied',
                'category' => 'CIP Applications',
                'when' => 'Sent when the Unit decides. The letter itself is kept under CIP settings → Granted and Denied letters; this wraps it. '.$when,
                'variables' => $vars + [
                    'decision' => 'Granted or Denied',
                    'decisionLower' => 'The same, lowercase',
                    'letterTitle' => "The decision letter's title",
                    'letterLead' => "The letter's opening line",
                    'letterBody' => 'The rest of the letter',
                    'recipient' => 'Full name of the person this copy is addressed to, when known',
                ],
                'sample' => $sample + [
                    'recipient' => 'Priya Sharma',
                    'decision' => 'Granted',
                    'decisionLower' => 'granted',
                    'letterTitle' => 'GAL26-00001 was granted',
                    'letterLead' => 'Please extend our congratulations to GAL26-00001 – Chen Wei on being granted citizenship of Saint Lucia.',
                    'letterBody' => new HtmlString('<p style="margin:0 0 12px;">Please find attached the official Notification Letter.</p>'),
                ],
                'sampleExtras' => ['details' => [['Application', 'GAL26-00001'], ['Applicant', 'Chen Wei'], ['Service provider', 'Galaxy Consultants'], ['Decision', 'Granted']]],
                'copy' => [
                    'preheader' => '{{number}} was {{decisionLower}}.',
                    'eyebrow' => 'CIP Applications',
                    'greeting' => '{{#recipient}}Dear {{recipient}},{{/recipient}}{{^recipient}}Dear Sir/Madam,{{/recipient}}',
                    'title' => '{{letterTitle}}',
                    'lead' => '{{letterLead}}',
                    'body' => '{{letterBody}}',
                    'button' => 'Open the application',
                    'footNote' => self::CIP_FOOT,
                ],
            ],
        ] + $statuses + [
            'cip-status' => [
                'name' => 'Status changed (other)',
                'category' => 'CIP Applications',
                'when' => 'Sent when a file moves to a status without its own template above. '.$when,
                'variables' => $vars + ['status' => 'The new status'],
                'sample' => $sample + ['status' => 'Background Check'],
                'sampleExtras' => $details,
                'copy' => $statusCopy,
            ],
        ];
    }

    private static function notifications(): array
    {
        return [
            'notification' => [
                'name' => 'Notification email',
                'category' => 'Notifications',
                'when' => 'The email twin of a portal notification, for accounts with the email channel on. The subject and body are the notification itself.',
                'variables' => [
                    'title' => "The notification's headline",
                    'message' => 'The notification text, when it has one',
                    'name' => "The recipient's first name, when known",
                    'module' => 'Which part of the portal it came from',
                    'actionLabel' => 'The button label the notification asked for',
                ],
                'sample' => ['title' => 'Dana Reed commented on Contract draft.pdf', 'message' => '“Looks good — one change on page 2.”', 'name' => 'Chen', 'module' => 'Files', 'actionLabel' => 'Open the file'],
                'copy' => [
                    'subject' => '{{title}}',
                    'preheader' => '{{#message}}{{message}}{{/message}}{{^message}}{{title}}{{/message}}',
                    'eyebrow' => '{{module}}',
                    'greeting' => self::HI_OR_HELLO,
                    'title' => '{{title}}',
                    'body' => '{{#message}}{{message}}{{/message}}',
                    'button' => '{{actionLabel}}',
                ],
            ],
        ];
    }
}
