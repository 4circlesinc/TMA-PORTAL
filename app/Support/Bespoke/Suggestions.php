<?php

namespace App\Support\Bespoke;

use App\Models\User;

/**
 * Role- and route-aware chips. Empty chat is chips, never fake messages.
 */
final class Suggestions
{
    /**
     * @param  array<string, mixed>  $identity
     * @param  array{path: string, view: string, title: string, kind: string}  $page
     * @return list<array{id: string, label: string, prompt: string, path?: string}>
     */
    public static function for(User $user, array $identity, array $page, bool $configured): array
    {
        $kind = $page['kind'];
        $cip = $identity['cipEnabled'] && ($identity['cipReach'] || Bespoke::can($user, 'clients.view'));
        $staff = $identity['isStaff'];
        $admin = $identity['isAdmin'];
        $client = $identity['isClient'] && ! $staff;

        $chips = match ($kind) {
            'cip-list' => self::cipList($cip, $staff, $admin, $identity),
            'cip-intake' => self::cipIntake($cip),
            'cip-file' => self::cipFile($cip, $staff, $admin),
            'files' => self::files($identity),
            'settings' => self::settings(),
            'email' => self::email(),
            'messages' => self::messages(),
            'dashboard' => self::dashboard($cip, $staff, $client),
            default => self::generic($cip, $staff, $client, $kind),
        };

        if ($configured) {
            $chips = array_merge($chips, self::abilities($user, $identity, $kind));
        } else {
            $chips = array_values(array_filter(
                $chips,
                fn (array $chip) => ($chip['id'] ?? '') !== 'compose-updates' && ($chip['id'] ?? '') !== 'rewrite',
            ));
        }

        return array_values(array_slice($chips, 0, 6));
    }

    /**
     * What the live assistant can do beyond answering: draft a message to
     * the person who looks after the portal, read an attached PDF, make a
     * 2×2 photo, list the reader's own files. Two per screen at most, so
     * the page's own chips stay first.
     *
     * @param  array<string, mixed>  $identity
     * @return list<array<string, string>>
     */
    private static function abilities(User $user, array $identity, string $kind): array
    {
        $chips = [];
        $cip = $identity['cipEnabled'] && ($identity['cipReach'] || Bespoke::can($user, 'clients.view'));

        if ($kind === 'cip-intake' || $kind === 'cip-file') {
            $chips[] = ['id' => 'photo-2x2', 'label' => 'Make a 2×2 photo', 'prompt' => 'I will attach a photo. Make it a 2×2 passport photo.'];
        }
        if ($cip && ($kind === 'dashboard' || $kind === 'cip-list' || $kind === 'overview')) {
            $chips[] = ['id' => 'my-apps', 'label' => 'Show my recent applications', 'prompt' => 'Show my recent applications.'];
        }
        if ($kind === 'dashboard' || $kind === 'settings' || $kind === 'page' || $kind === 'bespoke') {
            $chips[] = ['id' => 'report-issue', 'label' => 'Report a portal problem', 'prompt' => 'Draft a message to whoever looks after the portal: I am having a problem with a page.'];
        }
        if ($kind === 'files' || $kind === 'bespoke' || $kind === 'email') {
            $chips[] = ['id' => 'summarize-pdf', 'label' => 'Summarize a PDF', 'prompt' => 'I will attach a PDF. Summarize it in a few lines.'];
        }

        return array_slice($chips, 0, 2);
    }

    public static function subtitle(array $page): string
    {
        return match ($page['kind']) {
            'cip-intake' => 'I can walk through required fields.',
            'cip-list' => 'I can explain queues and how to file.',
            'cip-file' => 'Ask about this file’s status or next step.',
            'files' => 'Folder Shortcuts, File Box, and the library.',
            'settings' => 'Theme, 2FA, and connectors.',
            'email' => 'Mailbox, signatures, and drafts.',
            'messages' => 'Chat, calls, and screen share.',
            default => 'How can I help?',
        };
    }

    /** @return list<array<string, string>> */
    private static function dashboard(bool $cip, bool $staff, bool $client): array
    {
        $chips = [
            ['id' => 'dash-what', 'label' => 'What’s on this dashboard?', 'prompt' => 'What’s on this dashboard?'],
            ['id' => 'files-where', 'label' => 'Where is File Library?', 'prompt' => 'Where is File Library?'],
        ];
        if ($cip) {
            array_splice($chips, 1, 0, [[
                'id' => 'start-cip',
                'label' => 'How do I start a CIP application?',
                'prompt' => 'How do I start a CIP application?',
            ]]);
            $chips[] = [
                'id' => 'autosave',
                'label' => 'How does draft autosave work?',
                'prompt' => 'How does draft autosave work?',
            ];
        }
        if ($client) {
            $chips[] = [
                'id' => 'messages',
                'label' => 'How do I message staff?',
                'prompt' => 'How do Messages and calls work?',
            ];
        }
        if ($staff && ! $cip) {
            $chips[] = [
                'id' => '2fa',
                'label' => 'Turn on 2FA',
                'prompt' => 'How do I turn on two-factor?',
            ];
        }

        return $chips;
    }

    /** @return list<array<string, string>> */
    private static function cipList(bool $cip, bool $staff, bool $admin, array $identity): array
    {
        if (! $cip) {
            return self::dashboard(false, $staff, false);
        }

        $chips = [
            [
                'id' => 'start-cip',
                'label' => $identity['isProviderContact']
                    ? 'Create a pre-approval application'
                    : 'Create a pre-approval application',
                'prompt' => 'How do I start a CIP application?',
            ],
            ['id' => 'queues', 'label' => 'What are the queues?', 'prompt' => 'What are the queues?'],
        ];
        if ($admin) {
            $chips[] = ['id' => 'assign', 'label' => 'How do I assign an officer?', 'prompt' => 'How do I assign an officer?'];
        }
        if ($staff) {
            $chips[] = ['id' => 'invite', 'label' => 'How do I invite a service provider?', 'prompt' => 'How do I invite a service provider?'];
        }
        $chips[] = ['id' => 'draft-add', 'label' => 'Save as draft vs Add', 'prompt' => 'What’s the difference between Save as draft and Add?'];

        return $chips;
    }

    /** @return list<array<string, string>> */
    private static function cipIntake(bool $cip): array
    {
        if (! $cip) {
            return [];
        }

        return [
            ['id' => 'required', 'label' => 'What’s required to file?', 'prompt' => 'What’s required to file?'],
            ['id' => 'photo', 'label' => 'Photo rules', 'prompt' => 'What photo size is required?'],
            ['id' => 'dependents', 'label' => 'How do dependents work?', 'prompt' => 'How do dependents work?'],
            ['id' => 'draft-add', 'label' => 'Save as draft vs Add', 'prompt' => 'What’s the difference between Save as draft and Add?'],
        ];
    }

    /** @return list<array<string, string>> */
    private static function cipFile(bool $cip, bool $staff, bool $admin): array
    {
        if (! $cip) {
            return [];
        }

        $chips = [
            ['id' => 'status', 'label' => 'What does this status mean?', 'prompt' => 'What does this status mean?'],
            ['id' => 'queues', 'label' => 'What are the queues?', 'prompt' => 'What are the queues?'],
        ];
        if ($admin) {
            $chips[] = ['id' => 'assign', 'label' => 'How do I assign an officer?', 'prompt' => 'How do I assign an officer?'];
        }
        if ($staff) {
            $chips[] = ['id' => 'compose-updates', 'label' => 'Draft an updates-required note', 'prompt' => 'Draft a CIP updates-required message'];
        }

        return $chips;
    }

    /** @return list<array<string, string>> */
    private static function files(array $identity): array
    {
        $chips = [
            ['id' => 'pin', 'label' => 'Pin a folder shortcut', 'prompt' => 'How do I pin a folder?'],
        ];
        if (empty($identity['isProviderContact'])) {
            $chips[] = ['id' => 'filebox', 'label' => 'What’s File Box?', 'prompt' => 'What’s File Box?'];
        }
        $chips[] = ['id' => 'library', 'label' => 'Where is File Library?', 'prompt' => 'Where is File Library?'];

        return $chips;
    }

    /** @return list<array<string, string>> */
    private static function settings(): array
    {
        return [
            ['id' => '2fa', 'label' => 'Turn on 2FA', 'prompt' => 'How do I turn on two-factor?'],
            ['id' => 'sidebar', 'label' => 'Change sidebar style', 'prompt' => 'How do I change sidebar style?'],
            ['id' => 'theme', 'label' => 'Light or Dark', 'prompt' => 'How do I change Light or Dark?'],
        ];
    }

    /** @return list<array<string, string>> */
    private static function email(): array
    {
        return [
            ['id' => 'connect', 'label' => 'Connect a mailbox', 'prompt' => 'Why don’t I see Email?'],
            ['id' => 'search', 'label' => 'How do I search?', 'prompt' => 'How do I search?'],
        ];
    }

    /** @return list<array<string, string>> */
    private static function messages(): array
    {
        return [
            ['id' => 'calls', 'label' => 'How do I start a call?', 'prompt' => 'How do Messages and calls work?'],
            ['id' => 'screen', 'label' => 'How do I share my screen?', 'prompt' => 'How do Messages and calls work?'],
        ];
    }

    /** @return list<array<string, string>> */
    private static function generic(bool $cip, bool $staff, bool $client, string $kind): array
    {
        $chips = [
            ['id' => 'summarize', 'label' => 'Summarize this page', 'prompt' => 'Summarize this page'],
            ['id' => 'search', 'label' => 'How do I search?', 'prompt' => 'How do I search?'],
        ];
        if ($cip && $kind !== 'cip-list') {
            $chips[] = ['id' => 'start-cip', 'label' => 'How do I start a CIP application?', 'prompt' => 'How do I start a CIP application?'];
        }
        if ($client) {
            $chips[] = ['id' => 'files-where', 'label' => 'Where is File Library?', 'prompt' => 'Where is File Library?'];
        }
        if ($staff) {
            $chips[] = ['id' => '2fa', 'label' => 'Turn on 2FA', 'prompt' => 'How do I turn on two-factor?'];
        }

        return $chips;
    }
}
