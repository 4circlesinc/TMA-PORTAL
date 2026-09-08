<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Models\CipPersonChangeRequest;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Contacts;
use App\Support\Cip\PersonEdits;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Correcting the people on a post-approval file.
 *
 * The freeze that protects the submitted package was also holding every name
 * and date on the file, which left nobody able to fix a misspelling after the
 * decision. {@see PersonEdits} is the rule: an administrator's edit lands on
 * the record, everyone else's is a request an administrator answers.
 */
class CipPeopleController extends Controller
{
    public function update(Request $request, string $uuid, string $person): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $row = CipPerson::query()
            ->where('application_id', $application->id)
            ->where('uuid', $person)
            ->firstOrFail();

        $data = $request->validate([
            'firstName' => ['nullable', 'string', 'max:120'],
            'lastName' => ['nullable', 'string', 'max:120'],
            'gender' => ['nullable', 'string', Rule::in(['Male', 'Female'])],
            'dateOfBirth' => ['nullable', 'date'],
            'countryOfBirth' => ['nullable', 'string', 'max:120'],
            'countryOfResidence' => ['nullable', 'string', 'max:120'],
            'occupation' => ['nullable', 'string', 'max:160'],
            'passportNumber' => ['nullable', 'string', 'max:60'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $changes = collect($data)->only(PersonEdits::FIELDS)->all();

        try {
            $made = PersonEdits::submit($row, $user, $changes, $data['note'] ?? null);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json([
            // Null means it was applied; a uuid means it is waiting on an
            // administrator, and the screen says so rather than claiming a save.
            'requested' => $made?->uuid,
            'pendingChanges' => PersonEdits::pending($application->fresh()),
        ]);
    }

    public function decide(Request $request, string $uuid, string $requestUuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $row = CipPersonChangeRequest::query()
            ->where('application_id', $application->id)
            ->where('uuid', $requestUuid)
            ->firstOrFail();

        $data = $request->validate([
            'approve' => ['required', 'boolean'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        PersonEdits::decide($row, $user, (bool) $data['approve'], $data['note'] ?? null);

        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json([
            'pendingChanges' => PersonEdits::pending($application->fresh()),
        ]);
    }
}
