<?php

namespace App\Support\Templates;

use App\Models\Template;

/**
 * Firm compose templates: a named starting point for a mailbox email.
 *
 * Created and reworded on the admin Templates page (kind rows in the same
 * `templates` table the system emails use); offered read-only to anyone
 * with a mailbox, who picks one in compose and fills in the blanks. The
 * body is written in the same Markup mini-language as a system email's
 * body — paragraphs, bullets, **bold**, links — and rendered to HTML here,
 * so what compose inserts is exactly what the editor previewed.
 */
class ComposeTemplates
{
    public const KIND = 'compose-email';

    public static function bodyHtml(string $body): string
    {
        return Markup::html($body, []);
    }

    /** @return array<string, mixed> */
    public static function record(Template $template): array
    {
        $fields = $template->fields ?? [];

        return [
            'id' => $template->uuid,
            'name' => (string) $template->name,
            'subject' => (string) ($fields['subject'] ?? ''),
            'body' => (string) ($fields['body'] ?? ''),
            'bodyHtml' => self::bodyHtml((string) ($fields['body'] ?? '')),
            'updatedAt' => $template->updated_at?->toIso8601String(),
            'editor' => $template->editor?->name,
        ];
    }
}
