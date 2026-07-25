<?php

namespace App\Http\Controllers;

use App\Support\StaySignedIn;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class StaySignedInController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        if (! StaySignedIn::isNeeded($request)) {
            return redirect()->intended('/');
        }

        return view('auth.stay-signed-in');
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'stay' => ['required', 'in:yes,no'],
        ]);

        if ($data['stay'] === 'yes') {
            StaySignedIn::applyRemember($request);
        }

        StaySignedIn::clearNeeded($request);

        $response = redirect()->intended('/');

        foreach (StaySignedIn::answerCookies($request, $data['stay']) as $cookie) {
            $response->withCookie($cookie);
        }

        return $response;
    }
}
