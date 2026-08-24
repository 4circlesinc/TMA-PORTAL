<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Support\Access\Role;
use App\Support\Clients\ClientCustomFields;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Account settings > Client hub management > Custom fields.
 *
 * Defines the extra details the firm collects about every client. The values
 * are collected on the client record itself, see
 * {@see ClientCustomFields::sanitise()}, which every client write runs through.
 */
class ClientCustomFieldsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'settings.clientHub');

        $fields = ClientCustomFields::all();

        return response()->json([
            'canEdit' => Role::isAdmin($request->user()),
            'fields' => $fields,
            'types' => ClientCustomFields::TYPES,
            // How many client records already answer each field. Worth showing
            // before somebody deletes one: "delete this field" and "delete the
            // answers 200 clients gave it" are the same click.
            'usage' => $this->usage($fields),
            'clientCount' => Client::query()->count(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeWrite($request);

        $data = $this->rules($request);

        abort_if(
            count(ClientCustomFields::all()) >= ClientCustomFields::MAX_FIELDS,
            422,
            'You already have '.ClientCustomFields::MAX_FIELDS.' custom fields. Delete one first.'
        );

        $field = ClientCustomFields::create(
            $data['label'],
            $data['type'],
            $data['options'],
            $data['required'],
        );

        return response()->json(['field' => $field] + $this->index($request)->getData(true), 201);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $this->authorizeWrite($request);

        $data = $this->rules($request);

        $field = ClientCustomFields::update(
            $id,
            $data['label'],
            $data['type'],
            $data['options'],
            $data['required'],
        );

        abort_if($field === null, 404, 'That custom field no longer exists.');

        return response()->json(['field' => $field] + $this->index($request)->getData(true));
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->authorizeWrite($request);

        abort_unless(ClientCustomFields::delete($id), 404, 'That custom field no longer exists.');

        /* Values already stored against this field are left in place rather
           than swept out of every client record. They stop being read the
           moment the definition goes, sanitise() drops anything without a
           definition on the next write, so this is not data that resurfaces,
           and re-creating a field by mistake should not have meant a
           destructive pass over every client to undo. */
        return response()->json($this->index($request)->getData(true));
    }

    /** @return array{label: string, type: string, options: list<string>, required: bool} */
    private function rules(Request $request): array
    {
        $data = $request->validate([
            'label' => ['required', 'string', 'max:120'],
            'type' => ['required', Rule::in(ClientCustomFields::TYPES)],
            'options' => ['array', 'max:'.ClientCustomFields::MAX_OPTIONS],
            'options.*' => ['nullable', 'string', 'max:120'],
            'required' => ['sometimes', 'boolean'],
        ]);

        $options = $data['type'] === 'select' ? array_values($data['options'] ?? []) : [];

        // A dropdown with no options is a field nobody can answer.
        abort_if(
            $data['type'] === 'select' && array_filter(array_map('trim', $options)) === [],
            422,
            'A dropdown needs at least one option.'
        );

        return [
            'label' => $data['label'],
            'type' => $data['type'],
            'options' => $options,
            'required' => $request->boolean('required'),
        ];
    }

    /**
     * How many client records hold a value for each field.
     *
     * @param  list<array<string, mixed>>  $fields
     * @return array<string, int>
     */
    private function usage(array $fields): array
    {
        if ($fields === []) {
            return [];
        }

        $counts = array_fill_keys(array_column($fields, 'id'), 0);

        Client::query()->select('data')->cursor()->each(function (Client $client) use (&$counts) {
            $values = $client->data[ClientCustomFields::VALUE_KEY] ?? [];

            if (! is_array($values)) {
                return;
            }

            foreach ($values as $id => $value) {
                if (isset($counts[$id]) && $value !== null && $value !== '') {
                    $counts[$id]++;
                }
            }
        });

        return $counts;
    }

    private function authorizeWrite(Request $request): void
    {
        Role::authorize($request->user(), 'settings.clientHub');
        abort_unless(Role::isAdmin($request->user()), 403, 'Only administrators can change custom fields.');
    }
}
