<?php

namespace App\Support\Bespoke;

/**
 * The current SPA route, as far as Bespoke should trust it.
 *
 * The browser may send a path; we normalise it and refuse anything that is
 * not a portal page. We never fetch another person's file from this.
 */
final class Page
{
    /**
     * @param  array<string, mixed>  $clientContext
     * @return array{path: string, view: string, title: string, kind: string}
     */
    public static function fromClient(array $clientContext): array
    {
        $path = self::normalise(is_string($clientContext['path'] ?? null) ? $clientContext['path'] : '/');
        $view = is_string($clientContext['view'] ?? null) ? self::safeToken($clientContext['view']) : '';
        $title = is_string($clientContext['title'] ?? null) ? mb_substr($clientContext['title'], 0, 80) : '';

        $kind = self::kind($path, $view);
        if ($title === '') {
            $title = self::defaultTitle($kind, $path);
        }

        return [
            'path' => $path,
            'view' => $view,
            'title' => $title,
            'kind' => $kind,
        ];
    }

    /**
     * Visible form labels only — never values. Caps the list so a busy
     * intake form cannot dump the DOM into the prompt.
     *
     * @param  array<string, mixed>  $clientContext
     * @return list<array{label: string, empty: bool}>
     */
    public static function fieldHints(array $clientContext): array
    {
        $raw = $clientContext['fieldHints'] ?? [];
        if (! is_array($raw)) {
            return [];
        }

        $hints = [];
        foreach (array_slice($raw, 0, 40) as $row) {
            if (! is_array($row)) {
                continue;
            }
            $label = isset($row['label']) && is_string($row['label'])
                ? trim(mb_substr($row['label'], 0, 80))
                : '';
            if ($label === '') {
                continue;
            }
            $hints[] = [
                'label' => $label,
                'empty' => (bool) ($row['empty'] ?? false),
            ];
        }

        return $hints;
    }

    public static function normalise(string $path): string
    {
        $path = parse_url($path, PHP_URL_PATH) ?: $path;
        $path = '/'.ltrim($path, '/');
        if (strlen($path) > 1) {
            $path = rtrim($path, '/');
        }
        if (! str_starts_with($path, '/') || str_starts_with($path, '//')) {
            return '/';
        }
        if (strlen($path) > 180) {
            return '/';
        }

        return $path;
    }

    public static function kind(string $path, string $view = ''): string
    {
        if ($path === '/' || $view === 'dashboard') {
            return 'dashboard';
        }
        if ($path === '/overview' || $view === 'overview') {
            return 'overview';
        }
        if (str_starts_with($path, '/citizenship-applications')) {
            if (preg_match('#/citizenship-applications/new(?:/|$)#', $path) === 1
                || str_ends_with($path, '/edit')) {
                return 'cip-intake';
            }
            if ($path === '/citizenship-applications') {
                return 'cip-list';
            }

            return 'cip-file';
        }
        if (str_starts_with($path, '/folders')) {
            return 'files';
        }
        if (str_starts_with($path, '/email')) {
            return 'email';
        }
        if (str_starts_with($path, '/social/messages')) {
            return 'messages';
        }
        if (str_starts_with($path, '/social/feed')) {
            return 'feed';
        }
        if (str_starts_with($path, '/calendar')) {
            return 'calendar';
        }
        if (str_starts_with($path, '/signatures')) {
            return 'signatures';
        }
        if (str_starts_with($path, '/account-settings') || $path === '/settings') {
            return 'settings';
        }
        if ($path === '/users') {
            return 'users';
        }
        if ($path === '/reporting') {
            return 'reporting';
        }
        if (str_starts_with($path, '/bespoke-ai')) {
            return 'bespoke';
        }
        if (str_starts_with($path, '/templates')) {
            return 'templates';
        }
        if (str_starts_with($path, '/workflows')) {
            return 'workflows';
        }
        if (str_starts_with($path, '/people')) {
            return 'people';
        }
        if (str_starts_with($path, '/call-recordings')) {
            return 'calls';
        }

        return $view !== '' ? $view : 'page';
    }

    public static function defaultTitle(string $kind, string $path): string
    {
        return match ($kind) {
            'dashboard' => 'Dashboard',
            'overview' => 'Overview',
            'cip-list' => 'CIP Applications',
            'cip-intake' => str_contains($path, 'post') ? 'Post-approval intake' : 'CIP intake',
            'cip-file' => 'CIP application',
            'files' => 'File Library',
            'email' => 'Email',
            'messages' => 'Messages',
            'feed' => 'Feed',
            'calendar' => 'Calendar',
            'signatures' => 'Signature Requests',
            'settings' => 'Settings',
            'users' => 'Users',
            'reporting' => 'Reporting',
            'bespoke' => 'Bespoke AI Assistant',
            'templates' => 'Templates',
            'workflows' => 'Workflows',
            'people' => 'People',
            'calls' => 'Call Recordings',
            default => 'Portal',
        };
    }

    private static function safeToken(string $value): string
    {
        $value = strtolower(trim($value));
        if ($value === '' || strlen($value) > 40 || preg_match('/[^a-z0-9_-]/', $value) === 1) {
            return '';
        }

        return $value;
    }
}
