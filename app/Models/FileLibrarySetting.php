<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * Administrator-managed File Library configuration, stored as one row. Read
 * through the static helpers so callers get sensible defaults without caring
 * whether the row exists yet.
 */
#[Fillable(['settings'])]
class FileLibrarySetting extends Model
{
    protected function casts(): array
    {
        return [
            'settings' => 'array',
        ];
    }

    private const DEFAULTS = [
        'clientSubfolders' => ['Documents', 'Contracts', 'Invoices', 'Signed Documents'],
        'autoCreateStaffFolder' => false,
    ];

    /** @return array<string, mixed> */
    public static function current(): array
    {
        $row = self::query()->first();

        return array_merge(self::DEFAULTS, $row?->settings ?? []);
    }

    public static function put(array $values): array
    {
        $row = self::query()->first() ?? new self;
        $row->settings = array_merge(self::current(), $values);
        $row->save();

        return $row->settings;
    }

    /** @return array<int, string> */
    public static function clientSubfolders(): array
    {
        $names = self::current()['clientSubfolders'] ?? [];

        return array_values(array_filter(array_map('trim', is_array($names) ? $names : [])));
    }

    public static function autoCreateStaffFolder(): bool
    {
        return (bool) (self::current()['autoCreateStaffFolder'] ?? false);
    }
}
