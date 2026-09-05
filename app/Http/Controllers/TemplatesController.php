<?php

namespace App\Http\Controllers;

use App\Models\Template;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Templates\ComposeTemplates;
use App\Support\Templates\Markup;
use App\Support\Templates\SystemEmails;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Templates page's system-email API: list every transactional email with
 * its current copy, save an administrator's rewording, restore the shipped
 * default, and render a live preview of a draft. The whole group sits behind
 * `capability:templates.view` (administrators only, see Role::MATRIX).
 * Compose email templates sit behind `templates.email` so staff can keep
 * their own starting points; administrators can also publish firm defaults.
 */
class TemplatesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $overrides = Template::query()
            ->where('kind', SystemEmails::KIND)
            ->with('editor:id,name')
            ->get()
            ->keyBy('key');

        $templates = [];
        foreach (SystemEmails::keys() as $key) {
            $definition = SystemEmails::definition($key);
            $row = $overrides->get($key);
            $editable = SystemEmails::editableFields($key);

            $fields = [];
            $defaults = [];
            foreach ($editable as $field) {
                $default = $definition['copy'][$field] ?? '';
                $saved = $row->fields[$field] ?? null;
                $defaults[$field] = $default;
                $fields[$field] = is_string($saved) ? $saved : $default;
            }

            $templates[] = [
                'key' => $key,
                'name' => $definition['name'],
                'category' => $definition['category'],
                'when' => $definition['when'],
                'customized' => $row !== null,
                'updatedAt' => $row?->updated_at?->toIso8601String(),
                'editor' => $row?->editor?->name,
                'subjectFixed' => ! in_array('subject', $editable, true),
                'fields' => $fields,
                'defaults' => $defaults,
                'editable' => $editable,
                'variables' => collect(SystemEmails::variables($key))
                    ->map(fn (string $meaning, string $token) => ['token' => $token, 'meaning' => $meaning])
                    ->values()
                    ->all(),
            ];
        }

        return response()->json([
            'canEdit' => Role::can($request->user(), 'templates.view'),
            'fieldLabels' => SystemEmails::FIELD_LABELS,
            'fieldOrder' => SystemEmails::FIELDS,
            // The fields the editor offers rich formatting for; the rest are
            // plain text the postcard escapes.
            'htmlFields' => SystemEmails::HTML_FIELDS,
            'templates' => $templates,
        ]);
    }

    public function update(Request $request, string $key): JsonResponse
    {
        $this->find($key);

        $data = $request->validate([
            'fields' => ['required', 'array'],
            'fields.*' => ['nullable', 'string', 'max:20000'],
        ]);

        SystemEmails::save($key, $data['fields'], $request->user());

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'templates.system_email_updated',
            'module' => 'system',
            'description' => SystemEmails::definition($key)['name'].' email template updated',
            'new' => ['key' => $key],
        ]);

        return $this->record($key);
    }

    public function restore(Request $request, string $key): JsonResponse
    {
        $this->find($key);

        SystemEmails::restore($key);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'templates.system_email_restored',
            'module' => 'system',
            'description' => SystemEmails::definition($key)['name'].' email template restored to the default',
            'new' => ['key' => $key],
        ]);

        return $this->record($key);
    }

    /** Render the email with sample values, drafts and all, for the editor. */
    public function preview(Request $request, string $key): JsonResponse
    {
        $this->find($key);

        $data = $request->validate([
            'fields' => ['sometimes', 'array'],
            'fields.*' => ['nullable', 'string', 'max:20000'],
        ]);

        return response()->json(SystemEmails::preview($key, $data['fields'] ?? null));
    }

    /* ── Email (compose) templates ──────────────────────────────────
     * Named starting points a mailbox user can pick in compose. Everyone
     * with templates.email can create their own; administrators can publish
     * a default (`user_id` null) that every mailbox sees. The mailbox reads
     * them through MailController::composeTemplates under capability:mail.use.
     */

    public function emailIndex(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'canShareDefaults' => Role::isAdmin($user),
            'templates' => ComposeTemplates::visibleTo($user)
                ->with('editor:id,name')
                ->orderBy('name')
                ->get()
                ->map(fn (Template $t) => ComposeTemplates::record($t, $user))
                ->values(),
        ]);
    }

    public function emailStore(Request $request): JsonResponse
    {
        $data = $this->validateEmailTemplate($request);
        $user = $request->user();
        $shared = Role::isAdmin($user) && ($request->exists('shared')
            ? $request->boolean('shared')
            : true);

        $template = Template::create([
            'kind' => ComposeTemplates::KIND,
            'key' => (string) \Illuminate\Support\Str::uuid(),
            'name' => $data['name'],
            'fields' => ['subject' => $data['subject'], 'body' => $data['body']],
            'updated_by' => $user->id,
            'user_id' => $shared ? null : $user->id,
        ]);

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'templates.email_template_created',
            'module' => 'system',
            'description' => 'Email template “'.$template->name.'” created',
        ]);

        return response()->json(ComposeTemplates::record($template->load('editor'), $user), 201);
    }

    public function emailUpdate(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $template = $this->findEmailTemplate($request, $uuid);
        $this->authorizeEmailTemplateWrite($user, $template);
        $data = $this->validateEmailTemplate($request);

        $template->forceFill([
            'name' => $data['name'],
            'fields' => ['subject' => $data['subject'], 'body' => $data['body']],
            'updated_by' => $user->id,
        ]);

        if (Role::isAdmin($user) && $request->exists('shared')) {
            $template->user_id = $request->boolean('shared') ? null : $user->id;
        }

        $template->save();

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'templates.email_template_updated',
            'module' => 'system',
            'description' => 'Email template “'.$template->name.'” updated',
        ]);

        return response()->json(ComposeTemplates::record($template->refresh()->load('editor'), $user));
    }

    public function emailDestroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $template = $this->findEmailTemplate($request, $uuid);
        $this->authorizeEmailTemplateWrite($user, $template);
        $name = $template->name;
        $template->delete();

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'templates.email_template_deleted',
            'module' => 'system',
            'description' => 'Email template “'.$name.'” deleted',
        ]);

        return response()->json(['ok' => true]);
    }

    /** Render a draft body for the editor's live preview. */
    public function emailPreview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'subject' => ['nullable', 'string', 'max:500'],
            'body' => ['nullable', 'string', 'max:20000'],
        ]);

        return response()->json([
            'subject' => (string) ($data['subject'] ?? ''),
            'html' => ComposeTemplates::bodyHtml((string) ($data['body'] ?? '')),
        ]);
    }

    /** @return array{name: string, subject: string, body: string} */
    private function validateEmailTemplate(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:191'],
            'subject' => ['required', 'string', 'max:500'],
            'body' => ['required', 'string', 'max:20000'],
        ]);

        $data = array_map(fn ($v) => trim($v), $data);

        // A rich-editor body is stored already sanitized, so nothing unsafe
        // ever sits in the row or reaches the editor that reopens it.
        if (Markup::looksLikeHtml($data['body'])) {
            $data['body'] = Markup::sanitize($data['body']);
        }

        return $data;
    }

    private function findEmailTemplate(Request $request, string $uuid): Template
    {
        return ComposeTemplates::visibleTo($request->user())
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    private function authorizeEmailTemplateWrite(User $user, Template $template): void
    {
        abort_unless(ComposeTemplates::canEdit($user, $template), 403, 'You do not have access to this.');
    }

    private function find(string $key): void
    {
        abort_unless(in_array($key, SystemEmails::keys(), true), 404);
    }

    private function record(string $key): JsonResponse
    {
        $row = SystemEmails::override($key);
        $editable = SystemEmails::editableFields($key);
        $copy = SystemEmails::copy($key);

        return response()->json([
            'key' => $key,
            'customized' => $row !== null,
            'updatedAt' => $row?->updated_at?->toIso8601String(),
            'editor' => $row?->editor?->name,
            'fields' => array_intersect_key($copy, array_flip($editable)),
        ]);
    }
}
