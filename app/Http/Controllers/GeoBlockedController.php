<?php

namespace App\Http\Controllers;

use App\Support\Security\GeoAccess;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The screen a refused visitor is sent to.
 *
 * Its own page so the refusal has an address that reloads cleanly. Rendering
 * the block in place of whatever was asked for left the browser sitting on a
 * URL it retried on every reload, with the portal's own scripts firing XHRs
 * behind it that each came back 403 — a screen that flickered and a console
 * full of errors, for somebody who simply cannot come in.
 *
 * Reaching this page grants nothing. It reads the firm's message out of the
 * policy and renders static markup; every other route is still refused by
 * EnforceGeoAccess, on every request, for as long as the rule matches.
 *
 * Somebody no longer refused — the rule changed, they turned a VPN off — is
 * sent back to the portal rather than left reading a message that no longer
 * applies to them.
 */
class GeoBlockedController extends Controller
{
    public function show(Request $request): Response|RedirectResponse
    {
        $policy = GeoAccess::policy();

        $country = GeoAccess::refuse($request);
        $anonymiser = $country === null ? GeoAccess::refuseAnonymiser($request) : null;

        if ($country === null && $anonymiser === null) {
            return redirect('/');
        }

        return response()->view('errors.geo-blocked', [
            'message' => $anonymiser !== null ? $policy['vpnMessage'] : $policy['message'],
        ], 403);
    }
}
