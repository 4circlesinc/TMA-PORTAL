<?php

namespace App\Http\Controllers;

use App\Models\Template;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Templates\SystemEmails;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Templates page's system-email API: list every transactional email with
 * its current copy, save an administrator's rewording, restore the shipped
 * default, and render a live preview of a draft. The whole group sits behind
 * `capability:templates.view` (administrators only, see Role::MATRIX).
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
