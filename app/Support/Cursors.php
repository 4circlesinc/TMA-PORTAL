<?php

namespace App\Support;

class Cursors
{
    private static ?array $catalog = null;

    public static function catalog(): array
    {
        if (self::$catalog === null) {
            $path = base_path('design/cursors.json');
            self::$catalog = json_decode(file_get_contents($path), true);
        }

        return self::$catalog;
    }

    public static function all(): array
    {
        return self::catalog()['items'];
    }

    public static function find(string $name): ?array
    {
        foreach (self::all() as $cursor) {
            if ($cursor['name'] === $name) {
                return $cursor;
            }
        }

        return null;
    }

    public static function url(string $name): string
    {
        return asset('images/cursors/' . $name . '.png');
    }

    /** Full CSS cursor value, e.g. for inline styles. */
    public static function css(string $key): string
    {
        $map = [
            'default' => 'CursorsDefault',
            'pointer' => 'CursorsHandPointing',
            'grab' => 'CursorsHandOpen',
            'grabbing' => 'CursorsHandGrabbing',
            'text' => 'CursorsTextCursor',
            'crosshair' => 'CursorsCross',
            'move' => 'CursorsMove',
            'wait' => 'CursorsBeachball',
            'zoom-in' => 'CursorsZoomIn',
            'zoom-out' => 'CursorsZoomOut',
            'context-menu' => 'CursorsMenu',
            'n-resize' => 'CursorsResizeUp',
            's-resize' => 'CursorsResizeDown',
            'e-resize' => 'CursorsResizeRight',
            'w-resize' => 'CursorsResizeLeft',
            'ns-resize' => 'CursorsResizeNorthSouth',
            'ew-resize' => 'CursorsResizeWestEast',
            'nesw-resize' => 'CursorsResizeNorthEastSouthWest',
            'nwse-resize' => 'CursorsResizeNorthWestSouthEast',
        ];

        $name = $map[$key] ?? $key;
        $cursor = self::find($name);

        if ($cursor === null) {
            return $key;
        }

        $hx = $cursor['hotspot']['x'];
        $hy = $cursor['hotspot']['y'];

        return "url('" . self::url($name) . "') {$hx} {$hy}, {$cursor['fallback']}";
    }

    public static function cssPath(): string
    {
        return asset('css/cursors.css');
    }
}
