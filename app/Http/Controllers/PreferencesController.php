<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Notifications\ToastSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PreferencesController extends Controller
{
    /**
     * Personal preferences we persist per user, with their defaults. Only these
     * keys are accepted or returned — anything else is ignored, so the client
     * can't stuff arbitrary data into the column.
     */
    private const DEFAULTS = [
        'autoTimezone' => false,
        'timezone' => 'utc+0',
        'language' => 'en',
        'voice' => 'en-us',
        'sidebarStyle' => 'hover',
        // Calendar page chrome, remembered per user so the page reopens the
        // way it was left. Which calendars are ticked is not here — that is
        // server state on calendar_subscriptions.
        'calendarView' => 'month',
        'calendarSidebarOpen' => true,
    ];

    private const RULES = [
        'autoTimezone' => ['boolean'],
        'timezone' => ['string', 'max:32', 'regex:/^utc[+-]\d{1,2}$/'],
        'language' => ['string', 'max:16', 'regex:/^[a-z]{2}(-[a-z]{2,7})?$/i'],
        'voice' => ['string', 'max:32'],
        'sidebarStyle' => ['string', 'in:standard,hover'],
        'calendarView' => ['string', 'in:week,month,agenda,day,work_week'],
        'calendarSidebarOpen' => ['boolean'],
        // Nested toast prefs — validated + cleaned by ToastSettings.
        'toasts' => ['array'],
        'toasts.enabled' => ['boolean'],
        'toasts.position' => ['string', 'in:bottom-right,top-right,bottom-left'],
        'toasts.durationSec' => ['integer', 'in:3,5,8,10'],
        'toasts.stickyImportant' => ['boolean'],
        'toasts.sound' => ['boolean'],
        'toasts.previewText' => ['boolean'],
        'toasts.groupSimilar' => ['boolean'],
        // Portal home dashboard layout (order, sizes, visibility).
        'dashboardTiles' => ['array'],
        'dashboardLayout' => ['array'],
    ];

    private const TILE_IDS = [
        'email', 'recentFiles', 'shortcuts', 'employees',
        'favorites', 'tutorials', 'road',
    ];

    /** First-login admin/staff home board — mirrors the client defaults. */
    private const DEFAULT_DASHBOARD_ORDER = [
        'recentFiles', 'email', 'shortcuts', 'employees', 'favorites', 'road', 'tutorials',
    ];

    /** @var array<string, array{w: float, h: int}> */
    private const DEFAULT_DASHBOARD_SIZES = [
        'recentFiles' => ['w' => 0.34, 'h' => 300],
        'email' => ['w' => 0.66, 'h' => 300],
        'shortcuts' => ['w' => 1.0, 'h' => 320],
        'employees' => ['w' => 0.34, 'h' => 380],
        'favorites' => ['w' => 0.33, 'h' => 280],
        'road' => ['w' => 0.33, 'h' => 360],
        'tutorials' => ['w' => 0.33, 'h' => 280],
    ];

    /** @var array<string, bool> */
    private const DEFAULT_DASHBOARD_TILES = [
        'recentFiles' => true,
        'email' => true,
        'shortcuts' => true,
        'employees' => true,
        'favorites' => true,
        'road' => true,
        'tutorials' => false,
    ];

    /** The signed-in user's preferences, filled in with defaults. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $this->seedDashboardLayoutIfMissing($user);

        return response()->json($this->payload($user->fresh()));
    }

    /** Layout generation — bump when the shipped default board changes. */
    private const DASHBOARD_LAYOUT_VERSION = 2;

    /** Persist the default home board so every browser starts the same. */
    private function seedDashboardLayoutIfMissing(User $user): void
    {
        $current = $user->preferences ?? [];
        $version = (int) ($current['dashboardLayoutVersion'] ?? 0);

        if ($version >= self::DASHBOARD_LAYOUT_VERSION
            && isset($current['dashboardLayout'])
            && is_array($current['dashboardLayout'])) {
            return;
        }

        $current['dashboardLayout'] = [
            'order' => self::DEFAULT_DASHBOARD_ORDER,
            'tiles' => self::DEFAULT_DASHBOARD_SIZES,
        ];
        $current['dashboardTiles'] = array_merge(
            self::DEFAULT_DASHBOARD_TILES,
            is_array($current['dashboardTiles'] ?? null) ? $current['dashboardTiles'] : []
        );
        $current['dashboardLayoutVersion'] = self::DASHBOARD_LAYOUT_VERSION;

        $user->forceFill(['preferences' => $current])->save();
    }

    /** Merge-save any of the whitelisted preference keys. */
    public function update(Request $request): JsonResponse
    {
        $rules = [];
        foreach (self::RULES as $key => $rule) {
            $rules[$key] = array_merge(['sometimes', 'nullable'], $rule);
        }
        $data = $request->validate($rules);

        $user = $request->user();
        $current = $user->preferences ?? [];
        $booleans = ['autoTimezone', 'calendarSidebarOpen'];
        foreach ($data as $key => $value) {
            if ($key === 'toasts') {
                continue;
            }
            if ($key === 'dashboardTiles') {
                $current[$key] = $this->sanitizeDashboardTiles(is_array($value) ? $value : []);

                continue;
            }
            if ($key === 'dashboardLayout') {
                $current[$key] = $this->sanitizeDashboardLayout(is_array($value) ? $value : []);

                continue;
            }
            $current[$key] = in_array($key, $booleans, true) ? (bool) $value : $value;
        }

        $user->forceFill(['preferences' => $current])->save();

        if (isset($data['toasts']) && is_array($data['toasts'])) {
            ToastSettings::update($user, $data['toasts']);
        }

        return response()->json($this->payload($user->fresh()));
    }

    /** @return array<string, mixed> */
    private function payload(User $user): array
    {
        $stored = $user->preferences ?? [];

        $payload = array_merge(
            array_merge(self::DEFAULTS, array_intersect_key($stored, self::DEFAULTS)),
            ['toasts' => ToastSettings::for($user)]
        );

        if (isset($stored['dashboardTiles']) && is_array($stored['dashboardTiles'])) {
            $payload['dashboardTiles'] = array_merge(
                self::DEFAULT_DASHBOARD_TILES,
                $this->sanitizeDashboardTiles($stored['dashboardTiles'])
            );
        } else {
            $payload['dashboardTiles'] = self::DEFAULT_DASHBOARD_TILES;
        }

        if (isset($stored['dashboardLayout']) && is_array($stored['dashboardLayout'])) {
            $payload['dashboardLayout'] = $this->sanitizeDashboardLayout($stored['dashboardLayout']);
        } else {
            // First login (or never customized): stable default board.
            $payload['dashboardLayout'] = [
                'order' => self::DEFAULT_DASHBOARD_ORDER,
                'tiles' => self::DEFAULT_DASHBOARD_SIZES,
            ];
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $tiles
     * @return array<string, bool>
     */
    private function sanitizeDashboardTiles(array $tiles): array
    {
        $out = [];
        foreach (self::TILE_IDS as $id) {
            if (array_key_exists($id, $tiles)) {
                $out[$id] = (bool) $tiles[$id];
            }
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $layout
     * @return array{order: list<string>, tiles: array<string, array{w: float, h: int}>}
     */
    private function sanitizeDashboardLayout(array $layout): array
    {
        $orderIn = is_array($layout['order'] ?? null) ? $layout['order'] : [];
        $order = [];
        foreach ($orderIn as $id) {
            if (! is_string($id) || ! in_array($id, self::TILE_IDS, true)) {
                continue;
            }
            if (! in_array($id, $order, true)) {
                $order[] = $id;
            }
        }
        foreach (self::TILE_IDS as $id) {
            if (! in_array($id, $order, true)) {
                $order[] = $id;
            }
        }

        $tilesIn = is_array($layout['tiles'] ?? null) ? $layout['tiles'] : [];
        $tiles = [];
        foreach (self::TILE_IDS as $id) {
            if (! isset($tilesIn[$id]) || ! is_array($tilesIn[$id])) {
                continue;
            }
            $row = $tilesIn[$id];
            $w = isset($row['w']) ? (float) $row['w'] : null;
            // Legacy col spans (1–3) from the first resize iteration.
            if (($w === null || $w <= 0) && isset($row['cols'])) {
                $w = ((float) $row['cols']) / 3;
            }
            if ($w === null || $w <= 0) {
                continue;
            }
            $h = isset($row['h']) ? (int) $row['h'] : (isset($row['height']) ? (int) $row['height'] : 0);
            if ($h < 200) {
                continue;
            }
            $tiles[$id] = [
                'w' => round(min(1, max(0.2, $w)), 4),
                'h' => min(720, max(200, $h)),
            ];
        }

        return [
            'order' => $order,
            'tiles' => $tiles,
        ];
    }
}
