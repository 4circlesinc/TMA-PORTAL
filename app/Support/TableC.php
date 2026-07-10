<?php

namespace App\Support;

class TableC
{
    private static ?array $preset = null;

    public static function preset(): array
    {
        if (self::$preset === null) {
            self::$preset = json_decode(
                file_get_contents(base_path('design/table-c.json')),
                true
            );
        }

        return self::$preset;
    }

    public static function rows(): array
    {
        return TableA::rows();
    }

    public static function iconPath(string $name): string
    {
        return TableA::iconPath($name);
    }

    public static function statusVariant(string $status): string
    {
        return TableA::statusVariant($status);
    }

    public static function borderVariant(array $row): string
    {
        return TableA::borderVariant($row);
    }

    public static function isRowChecked(array $row): bool
    {
        return TableA::isRowChecked($row);
    }

    public static function tableTokens(): array
    {
        return TableA::preset()['tokens'] ?? [];
    }

    public static function columns(): array
    {
        return TableA::preset()['columns'] ?? [];
    }
}
