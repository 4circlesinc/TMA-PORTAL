<?php

namespace App\Http\Controllers\Design;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The email "postcard" documentation site. A staff-only gallery that renders
 * every transactional email the portal will send, from sample data, so the
 * designs can be reviewed and approved before any of them are wired to real
 * events. Each postcard is a payload for resources/views/mail/postcard.blade —
 * the same view the real Mailables will render — so what you approve here is
 * exactly what ships.
 *
 * Nothing here sends mail; it only renders.
 */
class MailPreviewController extends Controller
{
    /** Only the firm's own people may browse the template gallery. */
    private const STAFF = ['Administrator', 'Employee'];

    private const ACCENT_BLUE = '#136da0';
    private const ACCENT_RED = '#c0392b';
    private const ACCENT_GREEN = '#1e874b';

    /** The gallery shell: a sidebar of every postcard, and one previewed in an iframe. */
    public function index(Request $request, ?string $slug = null)
    {
        $this->authorizeStaff($request);

        $catalog = $this->catalog();
        $slug ??= array_key_first($this->flatten($catalog));

        return view('design.mail.index', [
            'groups' => $catalog,
            'current' => $slug,
            'currentEntry' => $this->flatten($catalog)[$slug] ?? null,
        ]);
    }

    /** A single postcard, rendered bare for the gallery iframe (and quick sharing). */
    public function show(Request $request, string $slug)
    {
        $this->authorizeStaff($request);

        $entry = $this->flatten($this->catalog())[$slug] ?? abort(404);

        return response()->view('mail.postcard', $entry['payload']);
    }

    private function authorizeStaff(Request $request): void
    {
        abort_unless(
            in_array($request->user()?->account_type, self::STAFF, true),
            Response::HTTP_FORBIDDEN,
            'The email gallery is staff-only.'
        );
    }

    /** slug => entry, ignoring the grouping, for lookups. */
    private function flatten(array $catalog): array
    {
        $flat = [];
        foreach ($catalog as $group) {
            foreach ($group['items'] as $slug => $entry) {
                $flat[$slug] = $entry;
            }
        }

        return $flat;
    }

    /**
     * The full catalog, grouped for the sidebar. Every payload is sample data —
     * realistic names, files and times so a reviewer sees the real shape of the
     * message, not "{{ placeholder }}".
     */
    private function catalog(): array
    {
        return [
            'account' => [
                'label' => 'Account &amp; sign-in',
                'items' => [
                    'verify-email' => [
                        'label' => 'Verify your email',
                        'subject' => 'Confirm your email address',
                        'payload' => [
                            'preheader' => 'One tap confirms your email and finishes setting up your account.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Confirm your email address',
                            'intro' => ['Thanks for creating an account with TM ANTOINE Advisory. Confirm this is your email address and we\'ll finish setting things up.'],
                            'button' => ['Confirm email address', '#'],
                            'fineprint' => 'This link expires in 60 minutes. If you didn\'t create an account, you can ignore this email.',
                            'showLink' => true,
                        ],
                    ],
                    'welcome' => [
                        'label' => 'Welcome / approved',
                        'subject' => 'Your account is ready',
                        'payload' => [
                            'preheader' => 'Your account has been approved — here\'s how to get started.',
                            'eyebrow' => 'Welcome',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Your account is approved and ready',
                            'intro' => [
                                'An administrator has approved your account. You now have access to your files, messages, calendar and everything the firm shares with you.',
                            ],
                            'details' => [
                                ['Signed in as', 'marcus.reid@example.com'],
                                ['Role', 'Client'],
                            ],
                            'button' => ['Open the portal', '#'],
                            'outro' => ['If you have any questions, just reply to a message inside the portal and a member of our team will help.'],
                            'accent' => self::ACCENT_GREEN,
                        ],
                    ],
                    'reset-password' => [
                        'label' => 'Reset password',
                        'subject' => 'Reset your password',
                        'payload' => [
                            'preheader' => 'Use the button below to choose a new password.',
                            'eyebrow' => 'Security',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Reset your password',
                            'intro' => ['We received a request to reset the password for your account. Choose a new one using the button below.'],
                            'button' => ['Choose a new password', '#'],
                            'fineprint' => 'This link expires in 60 minutes and can only be used once. If you didn\'t ask to reset your password, you can safely ignore this email — your current password still works.',
                            'showLink' => true,
                        ],
                    ],
                    'password-changed' => [
                        'label' => 'Password changed',
                        'subject' => 'Your password was changed',
                        'payload' => [
                            'preheader' => 'Confirming your account password was just changed.',
                            'eyebrow' => 'Security',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Your password was changed',
                            'intro' => ['This is a confirmation that the password on your account was just changed.'],
                            'details' => [
                                ['When', '27 Jul 2026, 2:14 PM'],
                                ['Device', 'Chrome on macOS'],
                                ['Location', 'Kingston, Jamaica (approx.)'],
                            ],
                            'note' => 'Didn\'t make this change? Reset your password immediately and contact us — someone else may have access to your account.',
                            'button' => ['Secure my account', '#'],
                            'accent' => self::ACCENT_RED,
                        ],
                    ],
                    'new-login' => [
                        'label' => 'New sign-in alert',
                        'subject' => 'New sign-in to your account',
                        'payload' => [
                            'preheader' => 'A new device just signed in to your account.',
                            'eyebrow' => 'Security',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'New sign-in to your account',
                            'intro' => ['We noticed a sign-in from a device we don\'t recognise. If this was you, no action is needed.'],
                            'details' => [
                                ['When', '27 Jul 2026, 2:14 PM'],
                                ['Device', 'Safari on iPhone'],
                                ['Location', 'Kingston, Jamaica (approx.)'],
                                ['IP address', '198.51.100.24'],
                            ],
                            'note' => 'Don\'t recognise this? Secure your account now — we recommend changing your password and reviewing your active sessions.',
                            'button' => ['Review activity', '#'],
                            'accent' => self::ACCENT_RED,
                        ],
                    ],
                    'email-change' => [
                        'label' => 'Confirm new email',
                        'subject' => 'Confirm your new email address',
                        'payload' => [
                            'preheader' => 'Confirm the new email address for your account.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Confirm your new email address',
                            'intro' => ['You asked to change the email address on your account to <strong>marcus.reid@newmail.com</strong>. Confirm the change to start using it.'],
                            'button' => ['Confirm new email', '#'],
                            'fineprint' => 'This link expires in 60 minutes. Until you confirm, your account keeps using your current email address.',
                        ],
                    ],
                    'two-factor' => [
                        'label' => 'Verification code',
                        'subject' => 'Your verification code',
                        'payload' => [
                            'preheader' => 'Your one-time verification code.',
                            'eyebrow' => 'Security',
                            'heading' => 'Your verification code',
                            'intro' => ['Enter this code to finish signing in. It expires in 10 minutes.'],
                            'note' => '<span style="font-size:26px;letter-spacing:.3em;font-weight:700;color:#111827;">418 209</span>',
                            'fineprint' => 'If you didn\'t try to sign in, someone may have your password. Change it as soon as you can.',
                        ],
                    ],
                ],
            ],

            'client-connect' => [
                'label' => 'Client connect',
                'items' => [
                    'client-invite' => [
                        'label' => 'Invite to connect files',
                        'subject' => 'Marcus, connect to your files with TM ANTOINE Advisory',
                        'payload' => [
                            'preheader' => 'Create your account to see the files we\'re working on together.',
                            'eyebrow' => 'You\'re invited',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Connect to your files with TM ANTOINE Advisory',
                            'intro' => [
                                'TM ANTOINE Advisory has set up a secure space for you in our client portal. Create your account and you\'ll be able to see the files we\'re working on together, message us directly, and follow along as things progress — all in one place.',
                            ],
                            'note' => 'This invitation was set up for you by Tanya Antoine. Creating your account links it to your existing records with us automatically.',
                            'button' => ['Create your account', '#'],
                            'outro' => ['Once you\'re in, you can upload documents, download what we\'ve prepared, and reach us without email back-and-forth.'],
                            'fineprint' => 'This invitation link is personal to you — please don\'t forward it. It expires in 14 days.',
                            'showLink' => true,
                            'accent' => self::ACCENT_BLUE,
                        ],
                    ],
                    'client-invite-reminder' => [
                        'label' => 'Invite reminder',
                        'subject' => 'Reminder: finish connecting to your files',
                        'payload' => [
                            'preheader' => 'Your invitation is still waiting — it takes about a minute.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Your invitation is still waiting',
                            'intro' => [
                                'A little while ago we invited you to connect to your files with TM ANTOINE Advisory. Your secure space is ready whenever you are — setting up your account takes about a minute.',
                            ],
                            'button' => ['Finish setting up', '#'],
                            'fineprint' => 'This invitation expires in 5 days. If you\'d rather not create an account, just let us know and we\'ll continue by email.',
                            'showLink' => true,
                        ],
                    ],
                ],
            ],

            'files' => [
                'label' => 'Files &amp; documents',
                'items' => [
                    'file-shared' => [
                        'label' => 'A file was shared',
                        'subject' => 'Tanya shared a file with you',
                        'payload' => [
                            'preheader' => 'A new document is waiting for you in the portal.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Tanya shared a file with you',
                            'intro' => ['A new document has been shared to your space in the portal.'],
                            'files' => [
                                ['2025-Financial-Statement.pdf', 'PDF · 2.4 MB · shared just now'],
                            ],
                            'note' => 'Here\'s the statement we discussed. Have a look and let me know if anything needs adjusting. — Tanya',
                            'button' => ['View the file', '#'],
                            'outro' => ['You can preview, download, or reply to us right from the file.'],
                        ],
                    ],
                    'file-chain' => [
                        'label' => 'File chain (multiple)',
                        'subject' => 'Tanya shared 4 files with you',
                        'payload' => [
                            'preheader' => 'Four documents were added to your space.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Tanya shared 4 files with you',
                            'intro' => ['These documents were added to the <strong>2025 Year-End</strong> folder in your space.'],
                            'files' => [
                                ['2025-Financial-Statement.pdf', 'PDF · 2.4 MB'],
                                ['Balance-Sheet-Q4.xlsx', 'Spreadsheet · 88 KB'],
                                ['Tax-Summary-2025.pdf', 'PDF · 512 KB'],
                                ['Engagement-Letter-Signed.pdf', 'PDF · 240 KB'],
                            ],
                            'button' => ['Open the folder', '#'],
                            'outro' => ['Everything stays together in this folder so you can find it later.'],
                        ],
                    ],
                    'file-updated' => [
                        'label' => 'File updated',
                        'subject' => 'A file you\'re following was updated',
                        'payload' => [
                            'preheader' => 'A new version of a document you\'re following is available.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'A file you\'re following was updated',
                            'intro' => ['A new version of a document in your space is now available.'],
                            'files' => [
                                ['2025-Financial-Statement.pdf', 'Version 3 · updated by Tanya · just now'],
                            ],
                            'button' => ['View the latest version', '#'],
                            'outro' => ['Previous versions are still kept, so nothing is lost.'],
                        ],
                    ],
                    'file-comment' => [
                        'label' => 'New comment on a file',
                        'subject' => 'New comment on 2025-Financial-Statement.pdf',
                        'payload' => [
                            'preheader' => 'Tanya left a comment on a file in your space.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'New comment on your file',
                            'intro' => ['Tanya left a comment on a document in your space.'],
                            'files' => [
                                ['2025-Financial-Statement.pdf', 'PDF · 2.4 MB'],
                            ],
                            'note' => 'On page 2 — could you confirm the figure in the second row? Once you do I\'ll finalise it.',
                            'button' => ['Reply to the comment', '#'],
                        ],
                    ],
                ],
            ],

            'messages' => [
                'label' => 'Message reminders',
                'items' => [
                    'message-reminder-1' => [
                        'label' => 'Unread (1 hour)',
                        'subject' => 'You have a new message from Tanya',
                        'payload' => [
                            'preheader' => 'Tanya sent you a message an hour ago.',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'You have a new message',
                            'intro' => ['Tanya sent you a message in the portal about an hour ago and it\'s still unread.'],
                            'note' => 'Hi Marcus — just checking in on the statement whenever you get a moment. — Tanya',
                            'button' => ['Read the message', '#'],
                            'fineprint' => 'You\'re getting this because you have unread messages. You can adjust reminders in your notification settings.',
                        ],
                    ],
                    'message-reminder-2' => [
                        'label' => 'Still waiting (~20 hours)',
                        'subject' => 'Still waiting to hear from you',
                        'payload' => [
                            'preheader' => 'Your message from Tanya is still unread.',
                            'eyebrow' => 'Reminder',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'Still waiting to hear from you',
                            'intro' => ['We reached out yesterday and haven\'t heard back. Your message is still waiting in the portal.'],
                            'details' => [
                                ['From', 'Tanya Antoine'],
                                ['Sent', 'Yesterday, 2:14 PM'],
                            ],
                            'note' => 'Hi Marcus — just checking in on the statement whenever you get a moment. — Tanya',
                            'button' => ['Read and reply', '#'],
                            'fineprint' => 'You\'re getting this because you have a message that\'s been unread for a while.',
                        ],
                    ],
                    'message-reminder-3' => [
                        'label' => 'Final reminder (24 hours)',
                        'subject' => 'A message from us is still waiting for you',
                        'payload' => [
                            'preheader' => 'One last reminder about your unread message.',
                            'eyebrow' => 'Final reminder',
                            'greeting' => 'Hi Marcus,',
                            'heading' => 'A message from us is still waiting for you',
                            'intro' => [
                                'It\'s been a full day and we still haven\'t heard back. We don\'t want anything important to slip through, so here\'s one last reminder.',
                                'If now isn\'t a good time, no problem — the message will be waiting whenever you\'re ready.',
                            ],
                            'note' => 'Hi Marcus — just checking in on the statement whenever you get a moment. — Tanya',
                            'button' => ['Open the conversation', '#'],
                            'outro' => ['Prefer we reach you another way? Just reply and let us know.'],
                            'fineprint' => 'This is the last automatic reminder we\'ll send for this message.',
                            'accent' => self::ACCENT_RED,
                        ],
                    ],
                ],
            ],
        ];
    }
}
