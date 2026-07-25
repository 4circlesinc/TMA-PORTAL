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
        if (! StaySignedIn::shouldAsk($request)) {
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

        return redirect()
            ->intended('/')
            ->withCookie(StaySignedIn::promptedCookie($request));
    }
}
