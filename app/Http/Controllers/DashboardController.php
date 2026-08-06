<?php

namespace App\Http\Controllers;

use App\Support\PortalShell;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class DashboardController extends Controller
{
    public function __invoke(Request $request): Response
    {
        // The shell embeds the menu, and PortalShell bakes the reader's
        // capabilities into it so the sidebar is complete in the first paint.
        // It is served no-store for both reasons: browsers must never keep an
        // old copy after deploy — that is what made the menu "never change" —
        // and must never hand one account's menu to the next.
        return PortalShell::respond(LegacyPageController::spaShellPath(), $request->user());
    }
}
