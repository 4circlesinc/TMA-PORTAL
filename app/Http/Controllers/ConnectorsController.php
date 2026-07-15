<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Storage connectors (OneDrive, SharePoint, …). Admins enable a connector
 * org-wide; individual users then link their own account via Microsoft Graph.
 * The OneDrive/SharePoint connectors are functional today because they ride on
 * the existing Microsoft OAuth. Box / Dropbox / Google Drive stay catalog-only.
 */
class ConnectorsController extends Controller
{
    /** Connectors that link through Microsoft Graph (really connectable now). */
    public const MICROSOFT_CONNECTORS = [
        'onedrive' => ['scope' => 'onedrive', 'name' => 'OneDrive'],
        'sharepoint' => ['scope' => 'sharepoint', 'name' => 'SharePoint Online'],
    ];

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $connected = $user->connectedAccounts()
            ->where('provider', 'microsoft')
            ->first();

        return response()->json([
            'isAdmin' => $this->isAdmin($user),
            'enabled' => $this->enabled(),
            'microsoftReady' => (bool) config('services.microsoft.sync'),
            'connectable' => array_keys(self::MICROSOFT_CONNECTORS),
            'linked' => [
                'onedrive' => (bool) $connected?->sync_onedrive,
                'sharepoint' => (bool) $connected?->sync_sharepoint,
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can change connectors.');

        $data = $request->validate([
            'id' => ['required', 'string', 'max:40'],
            'enabled' => ['required', 'boolean'],
        ]);

        $enabled = $this->enabled();
        $enabled = array_values(array_diff($enabled, [$data['id']]));
        if ($data['enabled']) {
            $enabled[] = $data['id'];
        }

        DB::table('portal_settings')->updateOrInsert(
            ['key' => 'connectors.enabled'],
            ['value' => json_encode(array_values(array_unique($enabled))), 'updated_at' => now(), 'updated_by' => $request->user()->id],
        );
        Cache::forget('portal-settings.connectors');

        return response()->json(['status' => 'ok', 'enabled' => $this->enabled()]);
    }

    private function enabled(): array
    {
        return Cache::remember('portal-settings.connectors', 60, function () {
            $row = DB::table('portal_settings')->where('key', 'connectors.enabled')->first();

            return $row ? (json_decode($row->value, true) ?: []) : [];
        });
    }

    private function isAdmin(User $user): bool
    {
        return $user->account_type === 'Administrator';
    }
}
