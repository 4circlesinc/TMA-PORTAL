<?php

namespace App\Support\Clients;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Extra fields a firm collects about every client.
 *
 * Account settings > Client hub management > Custom fields defines them. The
 * values live inside the client's own `data` blob under `custom`, beside the
 * phones and addresses, rather than in a table of their own, a client record
 * is already one irregular document and this is more of the same shape.
 *
 * The definitions are the firm's, so they sit in `portal_settings` next to
 * {@see ClientHubSettings}, not in the blob they describe.
 *
 * {@see self::sanitise()} is the part that stops this being another list that
 * saves and does nothing: every client write runs values through it, so a
 * field that was deleted stops being stored, a dropdown cannot hold a value
 * that is not one of its options, and nothing outside the definitions is kept.
 */
class ClientCustomFields
{
    /** The portal_settings row the definitions live in. */
    public const KEY = 'clients.custom-fields';

    /** Where the values sit inside a client's `data` blob. */
    public const VALUE_KEY = 'custom';

    public const TYPES = ['text', 'number', 'date', 'select'];

    public const MAX_FIELDS = 40;

    public const MAX_OPTIONS = 40;

    private static ?array $memo = null;

    /**
     * Every defined field, in the order the screen lists them.
     *
     * @return list<array{id: string, label: string, type: string, options: list<string>, required: bool}>
     */
    public static function all(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        $fields = [];

        foreach (self::stored() as $row) {
            if (! is_array($row) || ! isset($row['id'], $row['label'])) {
                continue;
            }

            $type = in_array($row['type'] ?? 'text', self::TYPES, true) ? $row['type'] : 'text';

            $fields[] = [
                'id' => (string) $row['id'],
                'label' => (string) $row['label'],
                'type' => $type,
                'options' => $type === 'select' ? self::cleanOptions($row['options'] ?? []) : [],
                'required' => (bool) ($row['required'] ?? false),
            ];
        }

        return self::$memo = $fields;
    }

    public static function find(string $id): ?array
    {
        foreach (self::all() as $field) {
            if ($field['id'] === $id) {
                return $field;
            }
        }

        return null;
    }

    /** @param  list<string>  $options */
    public static function create(string $label, string $type, array $options, bool $required): array
    {
        $field = [
            'id' => (string) Str::uuid(),
            'label' => trim($label),
            'type' => in_array($type, self::TYPES, true) ? $type : 'text',
            'options' => $type === 'select' ? self::cleanOptions($options) : [],
            'required' => $required,
        ];

        $all = self::all();
        $all[] = $field;
        self::put($all);

        return $field;
    }

    /** @param  list<string>  $options */
    public static function update(string $id, string $label, string $type, array $options, bool $required): ?array
    {
        $all = self::all();
        $updated = null;

        foreach ($all as $i => $field) {
            if ($field['id'] !== $id) {
                continue;
            }

            $updated = $all[$i] = [
                // The id never changes, it is what already-stored values are
                // filed under, and renaming a field must not orphan them.
                'id' => $id,
                'label' => trim($label),
                'type' => in_array($type, self::TYPES, true) ? $type : 'text',
                'options' => $type === 'select' ? self::cleanOptions($options) : [],
                'required' => $required,
            ];
        }

        if ($updated === null) {
            return null;
        }

        self::put($all);

        return $updated;
    }

    public static function delete(string $id): bool
    {
        $all = self::all();
        $kept = array_values(array_filter($all, fn (array $f) => $f['id'] !== $id));

        if (count($kept) === count($all)) {
            return false;
        }

        self::put($kept);

        return true;
    }

    /**
     * Keep only values that answer a field that currently exists, in the shape
     * that field expects.
     *
     * Called on every client write. Deliberately forgiving rather than
     * throwing: a client record is edited from several screens, and a stale
     * form posting a field somebody deleted this morning should drop the value,
     * not refuse to save the client's phone number.
     *
     * @param  array<string, mixed>  $profile  the client's whole `data` blob
     * @return array<string, mixed> the blob with `custom` normalised
     */
    public static function sanitise(array $profile): array
    {
        $fields = self::all();

        if ($fields === []) {
            unset($profile[self::VALUE_KEY]);

            return $profile;
        }

        $submitted = $profile[self::VALUE_KEY] ?? [];
        $submitted = is_array($submitted) ? $submitted : [];
        $clean = [];

        foreach ($fields as $field) {
            if (! array_key_exists($field['id'], $submitted)) {
                continue;
            }

            $value = self::coerce($field, $submitted[$field['id']]);

            if ($value !== null) {
                $clean[$field['id']] = $value;
            }
        }

        if ($clean === []) {
            unset($profile[self::VALUE_KEY]);

            return $profile;
        }

        $profile[self::VALUE_KEY] = $clean;

        return $profile;
    }

    /**
     * Which required fields a client record has no answer for.
     *
     * Returned rather than enforced: making a new required field retroactively
     * invalid would block every edit to every existing client until somebody
     * filled it in. The screen shows what is missing instead.
     *
     * @param  array<string, mixed>  $profile
     * @return list<string> the labels of unanswered required fields
     */
    public static function missingRequired(array $profile): array
    {
        $values = $profile[self::VALUE_KEY] ?? [];
        $values = is_array($values) ? $values : [];

        $missing = [];

        foreach (self::all() as $field) {
            if ($field['required'] && ($values[$field['id']] ?? '') === '') {
                $missing[] = $field['label'];
            }
        }

        return $missing;
    }

    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    /** Cast one submitted value to its field's type, or null to drop it. */
    private static function coerce(array $field, mixed $value): string|float|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return match ($field['type']) {
            'number' => is_numeric($value) ? (float) $value : null,
            // Stored as the plain date the form sent. Anything unparseable is
            // dropped rather than kept as free text under a date label.
            'date' => strtotime((string) $value) === false ? null : date('Y-m-d', strtotime((string) $value)),
            // A dropdown cannot hold a value that is not one of its options —
            // otherwise deleting an option silently leaves clients holding it.
            'select' => in_array((string) $value, $field['options'], true) ? (string) $value : null,
            default => mb_substr(trim((string) $value), 0, 1000),
        };
    }

    /** @return list<string> */
    private static function cleanOptions(mixed $options): array
    {
        if (! is_array($options)) {
            return [];
        }

        $clean = [];
        $seen = [];

        foreach ($options as $option) {
            $option = trim((string) $option);

            if ($option === '' || isset($seen[mb_strtolower($option)])) {
                continue;
            }

            $seen[mb_strtolower($option)] = true;
            $clean[] = $option;

            if (count($clean) >= self::MAX_OPTIONS) {
                break;
            }
        }

        return $clean;
    }

    private static function stored(): array
    {
        try {
            $stored = Cache::remember('portal-settings.'.self::KEY, 60, function () {
                $row = DB::table('portal_settings')->where('key', self::KEY)->first();

                return $row ? (json_decode($row->value, true) ?: []) : [];
            });
        } catch (Throwable) {
            return [];
        }

        return is_array($stored) ? $stored : [];
    }

    private static function put(array $fields): void
    {
        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            [
                'value' => json_encode(array_slice(array_values($fields), 0, self::MAX_FIELDS)),
                'updated_at' => now(),
            ],
        );

        self::flush();
    }
}
