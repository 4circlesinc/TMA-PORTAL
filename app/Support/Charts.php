<?php

namespace App\Support;

class Charts
{
    private static ?array $catalog = null;

    public static function catalog(): array
    {
        if (self::$catalog === null) {
            $path = base_path('design/charts.json');
            self::$catalog = json_decode(file_get_contents($path), true);
        }

        return self::$catalog;
    }

    public static function items(): array
    {
        return self::catalog()['items'];
    }

    public static function categories(): array
    {
        return self::catalog()['categories'];
    }

    public static function find(string $slug): ?array
    {
        foreach (self::items() as $item) {
            if ($item['slug'] === $slug || $item['file'] === $slug) {
                return $item;
            }
        }

        return null;
    }

    public static function file(string $name): string
    {
        $item = self::find($name);

        if ($item !== null) {
            return $item['file'];
        }

        return str_ends_with($name, '.svg') ? $name : "{$name}.svg";
    }

    public static function url(string $name): string
    {
        return asset('images/charts/' . self::file($name));
    }

    public static function cssPath(): string
    {
        return asset('css/charts.css');
    }
}
