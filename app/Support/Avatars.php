<?php

namespace App\Support;

class Avatars
{
    private static ?array $catalog = null;

    private static ?array $users = null;

    public static function catalog(): array
    {
        if (self::$catalog === null) {
            $path = base_path('design/avatars.json');
            self::$catalog = json_decode(file_get_contents($path), true);
        }

        return self::$catalog;
    }

    public static function users(): array
    {
        if (self::$users === null) {
            $path = base_path('design/avatar-names.json');
            self::$users = json_decode(file_get_contents($path), true)['users'];
        }

        return self::$users;
    }

    public static function url(string $key): string
    {
        return asset('images/avatars/' . $key . '.png');
    }

    public static function findBySlug(string $slug): ?array
    {
        foreach (self::users() as $user) {
            if ($user['slug'] === $slug) {
                return $user;
            }
        }

        return null;
    }

    public static function findByName(string $name): ?array
    {
        foreach (self::users() as $user) {
            if ($user['name'] === $name) {
                return $user;
            }
        }

        return null;
    }
}
