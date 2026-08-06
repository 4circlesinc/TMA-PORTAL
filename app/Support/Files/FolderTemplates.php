<?php

namespace App\Support\Files;

use App\Models\FileLibrarySetting;
use App\Models\Folder;
use Illuminate\Support\Str;

/**
 * Named sets of subfolders an administrator can drop into any folder.
 *
 * Account settings > Advanced Preferences > Folder Templates edits these, and
 * applying one is the only thing they do — a template is a shortcut for
 * "create these five folders here", nothing more. It holds no permissions and
 * owns nothing it creates.
 *
 * Stored in the File Library settings row rather than a table of their own,
 * next to `clientSubfolders`, which is the same kind of thing: a list of
 * folder names waiting to be created. Both go through
 * {@see FolderProvisioner::applySubfolders()}, so a template and the client
 * defaults create folders identically — including skipping names that already
 * exist, which is what makes applying one twice harmless.
 */
class FolderTemplates
{
    /** The File Library settings key the list lives under. */
    public const SETTING = 'folderTemplates';

    /** Sanity bounds. A template is a convenience, not a filing system. */
    public const MAX_TEMPLATES = 50;

    public const MAX_SUBFOLDERS = 50;

    /**
     * Every template, oldest first.
     *
     * @return list<array{id: string, name: string, subfolders: list<string>}>
     */
    public static function all(): array
    {
        $stored = FileLibrarySetting::current()[self::SETTING] ?? [];

        if (! is_array($stored)) {
            return [];
        }

        $templates = [];

        foreach ($stored as $row) {
            if (! is_array($row) || ! isset($row['id'], $row['name'])) {
                continue;
            }

            $templates[] = [
                'id' => (string) $row['id'],
                'name' => (string) $row['name'],
                'subfolders' => self::cleanNames($row['subfolders'] ?? []),
            ];
        }

        return $templates;
    }

    public static function find(string $id): ?array
    {
        foreach (self::all() as $template) {
            if ($template['id'] === $id) {
                return $template;
            }
        }

        return null;
    }

    /**
     * Add a template. Returns the stored row.
     *
     * @param  list<string>  $subfolders
     */
    public static function create(string $name, array $subfolders): array
    {
        $template = [
            'id' => (string) Str::uuid(),
            'name' => Naming::clean($name),
            'subfolders' => self::cleanNames($subfolders),
        ];

        $all = self::all();
        $all[] = $template;

        self::put($all);

        return $template;
    }

    /**
     * Replace a template's name and subfolders. Returns null if it is gone.
     *
     * @param  list<string>  $subfolders
     */
    public static function update(string $id, string $name, array $subfolders): ?array
    {
        $all = self::all();
        $updated = null;

        foreach ($all as $i => $template) {
            if ($template['id'] !== $id) {
                continue;
            }

            $updated = $all[$i] = [
                'id' => $id,
                'name' => Naming::clean($name),
                'subfolders' => self::cleanNames($subfolders),
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
        $kept = array_values(array_filter($all, fn (array $t) => $t['id'] !== $id));

        if (count($kept) === count($all)) {
            return false;
        }

        self::put($kept);

        return true;
    }

    /**
     * Create the template's subfolders inside a folder.
     *
     * Returns the names actually created — a name already present is skipped,
     * not duplicated, so applying the same template twice is a no-op rather
     * than a second set of "Contracts (2)" folders. Callers authorize first;
     * this does not check permissions.
     *
     * @return list<string>
     */
    public static function apply(array $template, Folder $target): array
    {
        return FolderProvisioner::applySubfolders($target, $template['subfolders']);
    }

    /**
     * Trim, clean and de-duplicate folder names, dropping blanks.
     *
     * Case-insensitive on the duplicate check because the folders themselves
     * are — two entries differing only in case would collide on creation and
     * silently produce one folder, which reads as a bug in the template.
     *
     * @return list<string>
     */
    private static function cleanNames(mixed $names): array
    {
        if (! is_array($names)) {
            return [];
        }

        $clean = [];
        $seen = [];

        foreach ($names as $name) {
            $name = Naming::clean((string) $name);

            if ($name === '') {
                continue;
            }

            $key = mb_strtolower($name);

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $clean[] = $name;

            if (count($clean) >= self::MAX_SUBFOLDERS) {
                break;
            }
        }

        return $clean;
    }

    private static function put(array $templates): void
    {
        FileLibrarySetting::put([
            self::SETTING => array_slice(array_values($templates), 0, self::MAX_TEMPLATES),
        ]);
    }
}
