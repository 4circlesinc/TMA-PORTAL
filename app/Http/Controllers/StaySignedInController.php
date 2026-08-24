<?php

namespace App\Http\Controllers;

use App\Support\SafeIntended;
use App\Support\StaySignedIn;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\View\View;

class StaySignedInController extends Controller
{
    public function show(Request $request): View|RedirectResponse
    {
        if (! StaySignedIn::isNeeded($request)) {
            SafeIntended::scrub();

            return redirect()->intended('/');
        }

        return view('auth.stay-signed-in');
    }

    public function store(Request $request): RedirectResponse
    {
        // Sent back to this screen by name rather than by `back()`: a failure
        // here is held by EnsureStaySignedInChoice anyway, and bouncing via the
        // referer let the flashed message be consumed by the intermediate
        // redirect — leaving the person on a prompt whose buttons looked dead.
        $validator = Validator::make($request->all(), [
            'stay' => ['required', 'in:yes,no'],
        ], [
            'stay.required' => 'Choose whether to stay signed in on this browser.',
        ]);

        if ($validator->fails()) {
            return redirect()->route('stay-signed-in.show')->withErrors($validator);
        }

        $data = $validator->validated();

        if ($data['stay'] === 'yes') {
            StaySignedIn::applyRemember($request);
        }

        StaySignedIn::clearNeeded($request);

        SafeIntended::scrub();
        $response = redirect()->intended('/');

        foreach (StaySignedIn::answerCookies($request, $data['stay']) as $cookie) {
            $response->withCookie($cookie);
        }

        return $response;
    }
}
