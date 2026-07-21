<?php

namespace App\Http\Controllers;

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
    ];

    private const RULES = [
        'autoTimezone' => ['boolean'],
        'timezone' => ['string', 'max:32', 'regex:/^utc[+-]\d{1,2}$/'],
        'language' => ['string', 'max:16', 'regex:/^[a-z]{2}(-[a-z]{2,7})?$/i'],
        'voice' => ['string', 'max:32'],
        'sidebarStyle' => ['string', 'in:standard,hover'],
    ];

    /** The signed-in user's preferences, filled in with defaults. */
    public function show(Request $request): JsonResponse
    {
        return response()->json($this->merged($request->user()->preferences ?? []));
    }

    /** Merge-save any of the whitelisted preference keys. */
    public function update(Request $request): JsonResponse
    {
        $rules = [];
        foreach (self::RULES as $key => $rule) {
            $rules[$key] = array_merge(['sometimes', 'nullable'], $rule);
        }
        $data = $request->validate($rules);

        $current = $request->user()->preferences ?? [];
        foreach ($data as $key => $value) {
            $current[$key] = $key === 'autoTimezone' ? (bool) $value : $value;
        }

        $request->user()->forceFill(['preferences' => $current])->save();

        return response()->json($this->merged($current));
    }

    private function merged(array $stored): array
    {
        return array_merge(self::DEFAULTS, array_intersect_key($stored, self::DEFAULTS));
    }
}
