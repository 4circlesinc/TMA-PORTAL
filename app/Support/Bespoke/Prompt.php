<?php

namespace App\Support\Bespoke;

use App\Models\User;

/**
 * System prompt for the live model. Role and capabilities come from the
 * session. The browser may only contribute path, title, and field labels.
 */
final class Prompt
{
    /**
     * @param  array<string, mixed>  $identity
     * @param  array{path: string, view: string, title: string, kind: string}  $page
     * @param  list<array{label: string, empty: bool}>  $fieldHints
     */
    public static function system(User $user, array $identity, array $page, array $fieldHints): string
    {
        $allowed = Knowledge::allowedPaths($user, $identity);
        $account = $identity['accountType'];
        if ($identity['isProviderContact']) {
            $account .= ' (service-provider contact)';
        }

        $canOpen = implode(', ', $allowed);
        $caps = implode(', ', $identity['capabilities'] ?: ['(none beyond the personal shell)']);

        $cipLine = $identity['cipEnabled']
            ? 'FEATURE_CIP is on. You may describe CIP Applications for this reader if they can open them.'
            : 'FEATURE_CIP is off. Do not mention CIP Applications, intake, queues, or service providers as a product area. If asked, say that module is not available and offer another portal page.';

        $staffLine = $identity['isStaff']
            ? 'This reader is staff. You may mention administration pages they can actually open (see allowed paths).'
            : 'This reader is not staff. Never mention Users, Reporting, People, Templates, CIP Console, Call Recordings, or other staff-only areas. Do not chip or link those paths.';

        $intake = $page['kind'] === 'cip-intake' && $identity['cipEnabled']
            ? Knowledge::intakeChecklist($fieldHints)
            : '';

        $parts = [
            'You are Bespoke AI Assistant in the TM ANTOINE Advisory Portal.',
            'Voice: calm, precise, slightly formal. Short sentences. Never cute. Never say you are an AI or a language model.',
            'Job: help this signed-in person use THIS portal. Not a general-purpose chatbot. Not legal advice. Not investment advice. Never answer whether an application will be granted.',
            'If you are not sure, say so and offer a deep link or “ask an administrator”.',
            'Never invent screens, buttons, or statuses that are not listed below.',
            'Never write or submit form data. Drafts of messages go in the chat with a note to copy. Do not send.',
            'Do not ask them to paste passports, emails, or other PII. If they already pasted something, do not repeat it back in full.',
            'When the answer is a place, include a markdown link with a real path from the allowed list, for example [CIP Applications](/citizenship-applications).',
            $cipLine,
            'Do not describe a Citizenship by Investment Smartsheet / CBI module. If it is off, it does not exist.',
            $staffLine,
            'Account type: '.$account.'.',
            'Capabilities: '.$caps.'.',
            'Allowed paths: '.$canOpen.'.',
            'Current page: '.$page['title'].' ('.$page['path'].', kind '.$page['kind'].').',
            'Locale: '.$identity['locale'].'. Theme: '.$identity['theme'].'.',
            'User-guide facts for this page:',
            Knowledge::pageGuide($identity, $page),
        ];

        if ($intake !== '') {
            $parts[] = 'Intake checklist:';
            $parts[] = $intake;
        }

        if ($identity['cipEnabled'] && str_starts_with($page['kind'], 'cip')) {
            $parts[] = Knowledge::statusFacts();
        }

        $parts[] = 'Refuse to discuss other people’s files, applications, or users. You have no live case lookup in this turn; tell them to open the file.';

        return implode("\n\n", $parts);
    }
}
