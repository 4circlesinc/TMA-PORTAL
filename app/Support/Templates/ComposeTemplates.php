<?php

namespace App\Support\Templates;

use App\Models\Template;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;

/**
 * Compose templates: a named starting point for a mailbox email.
 *
 * Two visibilities share the `compose-email` kind:
 *   - `user_id` null — a firm default every mailbox can pick (administrators
 *     publish those from Templates → Email templates).
 *   - `user_id` set — that person's own template; only they see and edit it.
 *
 * The body is written in the same Markup mini-language as a system email's
 * body — paragraphs, bullets, **bold**, links — and rendered to HTML here,
 * so what compose inserts is exactly what the editor previewed. A rich-editor
 * body is stored already sanitised.
 */
class ComposeTemplates
{
    public const KIND = 'compose-email';

    public static function bodyHtml(string $body): string
    {
        return Markup::html($body, []);
    }

    /**
     * Firm defaults plus this person's own templates.
     *
     * @return Builder<Template>
     */
    public static function visibleTo(User $user): Builder
    {
        return Template::query()
            ->where('kind', self::KIND)
            ->where(function (Builder $query) use ($user) {
                $query->whereNull('user_id')->orWhere('user_id', $user->id);
            });
    }

    public static function isShared(Template $template): bool
    {
        return $template->user_id === null;
    }

    public static function canEdit(User $user, Template $template): bool
    {
        if ((int) $template->user_id === (int) $user->id) {
            return true;
        }

        return self::isShared($template) && Role::isAdmin($user);
    }

    /** @return array<string, mixed> */
    public static function record(Template $template, ?User $viewer = null): array
    {
        $fields = $template->fields ?? [];
        $shared = self::isShared($template);

        return [
            'id' => $template->uuid,
            'name' => (string) $template->name,
            'subject' => (string) ($fields['subject'] ?? ''),
            'body' => (string) ($fields['body'] ?? ''),
            'bodyHtml' => self::bodyHtml((string) ($fields['body'] ?? '')),
            'shared' => $shared,
            'mine' => $viewer !== null && (int) $template->user_id === (int) $viewer->id,
            'canEdit' => $viewer !== null && self::canEdit($viewer, $template),
            'updatedAt' => $template->updated_at?->toIso8601String(),
            'editor' => $template->editor?->name,
        ];
    }

    /**
     * What a mailbox may read: rendered HTML, never source, plus whether
     * the row is a firm default so compose can group the picker.
     *
     * @return array{id: string, name: string, subject: string, bodyHtml: string, shared: bool}
     */
    public static function mailboxRecord(Template $template): array
    {
        $fields = $template->fields ?? [];

        return [
            'id' => $template->uuid,
            'name' => (string) $template->name,
            'subject' => (string) ($fields['subject'] ?? ''),
            'bodyHtml' => self::bodyHtml((string) ($fields['body'] ?? '')),
            'shared' => self::isShared($template),
        ];
    }
}
