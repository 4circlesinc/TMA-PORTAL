<?php

namespace App\Http\Controllers;

use App\Models\Calendar;
use App\Models\User;
use App\Support\Calendar\CalendarProvisioner;
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
        // Auto by default: the client detects the device's IANA zone and
        // stores it in `timezone`, which the calendar reads for new users.
        'autoTimezone' => true,
        'timezone' => 'utc+0',
        // 'auto' follows the browser's language; i18n.js resolves it.
        'language' => 'auto',
        'voice' => 'en-us',
        'sidebarStyle' => 'hover',
        // Email notifications even while actively using the portal — off means
        // "don't email me what the bell already showed me".
        'notifyAlwaysEmail' => false,
        // Theme panel. These used to live only in localStorage, so the look
        // reset on every new browser — they follow the account now.
        'themeMode' => 'system',
        'fontScale' => 3,
        'accentColor' => 'indigo',
        // Privacy panel. "necessary" cookies are not stored: they are always
        // on and the switch is hard-locked in the UI.
        'cookieFunctional' => true,
        'cookieAnalytics' => true,
        'cookieMarketing' => true,
        'historyDays' => 30,
        // Plugins panel. null means "never customized" — the client falls
        // back to its shipped catalog. Once set, the stored list is
        // authoritative for membership as well as on/off, so removing a
        // plugin sticks instead of reappearing on reload.
        'plugins' => null,
        // Calendar page chrome, remembered per user so the page reopens the
        // way it was left. Which calendars are ticked is not here — that is
        // server state on calendar_subscriptions.
        'calendarView' => 'month',
        'calendarSidebarOpen' => true,
        /*
         * The File Library's "…synced 2 hours ago" line, once dismissed.
         *
         * Stored on the account rather than in localStorage so closing it
         * means closing it — not closing it again on the next browser. It
         * only ever hides the QUIET line; an in-progress sync and a sync
         * error both still show, because those are worth interrupting for.
         */
        'fileSyncNoticeDismissed' => false,
    ];

    private const RULES = [
        'autoTimezone' => ['boolean'],
        // Legacy utc±N picker ids, or a real IANA name ("America/New_York")
        // from auto-detection — only IANA values are honoured downstream
        // (CalendarProvisioner::defaultTimezone re-validates against PHP's
        // timezone list).
        'timezone' => ['string', 'max:64', 'regex:#^(utc[+-]\d{1,2}|[A-Za-z][A-Za-z_]*(/[A-Za-z0-9_+\-]+){1,2})$#'],
        'language' => ['string', 'max:16', 'regex:/^(auto|[a-z]{2}(-[a-z]{2,7})?)$/i'],
        'voice' => ['string', 'max:32'],
        'sidebarStyle' => ['string', 'in:standard,hover'],
        'notifyAlwaysEmail' => ['boolean'],
        'themeMode' => ['string', 'in:system,light,dark'],
        'fontScale' => ['integer', 'between:1,5'],
        'accentColor' => ['string', 'in:indigo,yellow,red,blue,orange,green'],
        'cookieFunctional' => ['boolean'],
        'cookieAnalytics' => ['boolean'],
        'cookieMarketing' => ['boolean'],
        'historyDays' => ['integer', 'in:7,14,30,60,90,365'],
        // Plugin catalog lives in the client; we only keep id + on/off.
        'plugins' => ['array'],
        'plugins.*.id' => ['required', 'string', 'max:40'],
        'plugins.*.enabled' => ['boolean'],
        'calendarView' => ['string', 'in:week,month,agenda,day,work_week'],
        'calendarSidebarOpen' => ['boolean'],
        'fileSyncNoticeDismissed' => ['boolean'],
        // Nested toast prefs — validated + cleaned by ToastSettings.
        'toasts' => ['array'],
        'toasts.enabled' => ['boolean'],
        'toasts.position' => ['string', 'in:bottom-right,top-right,bottom-left'],
        'toasts.durationSec' => ['integer', 'in:3,5,8,10'],
        'toasts.stickyImportant' => ['boolean'],
        'toasts.sound' => ['boolean'],
        'toasts.previewText' => ['boolean'],
        'toasts.groupSimilar' => ['boolean'],
        // Portal home dashboard layout (order + visibility).
        'dashboardTiles' => ['array'],
        'dashboardLayout' => ['array'],
    ];

    private const TILE_IDS = [
        'recentFiles', 'email', 'shortcuts', 'favorites',
        'road', 'employees', 'tutorials',
    ];

    /**
     * Default home board — mirrors the client masonry columns:
     * Recent Files → Favorites | Recent Email → Road | Shortcuts → Employees.
     */
    private const DEFAULT_DASHBOARD_ORDER = [
        'recentFiles', 'email', 'shortcuts', 'favorites', 'road', 'employees', 'tutorials',
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
    private const DASHBOARD_LAYOUT_VERSION = 10;

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
        $booleans = [
            'autoTimezone', 'calendarSidebarOpen', 'notifyAlwaysEmail',
            'cookieFunctional', 'cookieAnalytics', 'cookieMarketing',
        ];
        foreach ($data as $key => $value) {
            if ($key === 'toasts') {
                continue;
            }
            if ($key === 'plugins') {
                // An explicit null puts the list back to "never customized",
                // which is not the same as an empty list (every plugin
                // removed) — the client falls back to its catalog for one and
                // shows nothing for the other.
                $current[$key] = is_array($value) ? $this->sanitizePlugins($value) : null;

                continue;
            }
            if ($key === 'dashboardTiles') {
                $current[$key] = $this->sanitizeDashboardTiles(is_array($value) ? $value : []);

                continue;
            }
            if ($key === 'dashboardLayout') {
                $current[$key] = $this->sanitizeDashboardLayout(is_array($value) ? $value : []);
                $current['dashboardLayoutVersion'] = self::DASHBOARD_LAYOUT_VERSION;

                continue;
            }
            if (in_array($key, $booleans, true)) {
                $current[$key] = (bool) $value;

                continue;
            }
            // The `integer` rule accepts numeric strings, so normalize here —
            // otherwise "3" round-trips and the client sees a string.
            $current[$key] = in_array($key, ['fontScale', 'historyDays'], true)
                ? (int) $value
                : $value;
        }

        $user->forceFill(['preferences' => $current])->save();

        if (isset($data['toasts']) && is_array($data['toasts'])) {
            ToastSettings::update($user, $data['toasts']);
        }

        // A changed time zone re-times the person's own local calendars, so
        // the setting is visible immediately — provider-synced calendars keep
        // the zone the provider reports.
        if (array_key_exists('timezone', $data)) {
            Calendar::query()
                ->where('owner_id', $user->id)
                ->where('source', Calendar::SOURCE_LOCAL)
                ->update(['timezone' => CalendarProvisioner::defaultTimezone($user->fresh())]);
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
            ];
        }

        return $payload;
    }

    /**
     * Keep the plugin list to `{id, enabled}` pairs, first occurrence wins.
     * The catalog itself is the client's, so we don't police which ids are
     * real — only the shape, so the column can't be used as scratch storage.
     *
     * @param  array<int, mixed>  $plugins
     * @return list<array{id: string, enabled: bool}>
     */
    private function sanitizePlugins(array $plugins): array
    {
        $out = [];
        $seen = [];
        foreach ($plugins as $plugin) {
            if (! is_array($plugin) || ! is_string($plugin['id'] ?? null)) {
                continue;
            }
            $id = $plugin['id'];
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $out[] = ['id' => $id, 'enabled' => (bool) ($plugin['enabled'] ?? false)];
        }

        return $out;
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
     * @return array{order: list<string>}
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

        return [
            'order' => $order,
        ];
    }
}
