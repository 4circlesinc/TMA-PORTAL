<?php

namespace App\Http\Controllers;

use App\Models\SharePointConnection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Settings → Connectors. The portal's Microsoft connections: Outlook mail,
 * Calendar, and OneDrive. One consent covers all three (sync_all on the
 * social redirect), so each tile reflects a facet of the same connected
 * account rather than a separate link. Staff connect during onboarding;
 * this page is the fallback for checking status or reconnecting.
 */
class ConnectorsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $account = $request->user()->connectedAccounts()
            ->where('provider', 'microsoft')
            ->first();

        $drive = SharePointConnection::personalDriveFor($request->user());

        return response()->json([
            'microsoftReady' => (bool) config('services.microsoft.sync') && (bool) config('services.microsoft.client_id'),
            'connected' => (bool) $account,
            'email' => $account?->email,
            'features' => [
                'email' => [
                    'linked' => (bool) $account?->sync_email,
                    'writable' => (bool) $account?->canWriteMail(),
                ],
                'calendar' => [
                    'linked' => (bool) $account?->sync_calendar,
                    'readable' => (bool) $account?->canReadCalendar(),
                    'writable' => (bool) $account?->canWriteCalendar(),
                ],
                'onedrive' => [
                    'linked' => (bool) $account?->sync_onedrive,
                    // The drive row exists once provisioning ran; the pause
                    // control only makes sense against a real connection.
                    'ready' => (bool) $drive,
                    'paused' => (bool) $drive?->paused_at,
                ],
            ],
        ]);
    }
}
