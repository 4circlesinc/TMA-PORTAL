<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Countries;
use App\Support\Cip\Dependents;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\Intake;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\PassportPhoto;
use App\Support\Cip\Status;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CIP applications: what the intake wizard needs, and filing one.
 *
 * The gate is CipAccess, not the capability matrix alone — Service Provider
 * contacts and Private Clients are promised application creation by §1 and
 * hold no matrix capability by design. 404 rather than 403 throughout, the
 * portal's convention for anything a reader may not see.
 */
class CipApplicationController extends Controller
{
    /** Everything the wizard needs to draw itself, in one request. */
    public function form(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $providers = Intake::providersFor($user)
            ->map(fn (CipProvider $p) => ['id' => $p->uuid, 'name' => $p->name, 'code' => $p->code])
            ->values();

        return response()->json([
            'providers' => $providers,
            // One provider and no choice to make: the wizard shows the name
            // rather than a select of one.
            'providerFixed' => $providers->count() === 1,
            'countries' => Countries::options(),
            'investmentTypes' => InvestmentType::options(),
            'genders' => ['Male', 'Female'],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $data = $request->validate(Intake::rules(), Intake::messages());

        // A provider this account may not file under is not offered and not
        // accepted — the same list the form was drawn from decides.
        $provider = Intake::providersFor($user)->firstWhere('uuid', $data['providerId']);
        abort_unless($provider, 422, 'Choose a service provider you can file under.');

        $application = Intake::create($provider, $user, $data);

        Live::staff(Live::CIP);

        return response()->json([
            'application' => $this->record($application),
        ], 201);
    }

    /** One application, if this reader may see it. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $application = ApplicationScope::findOrFail($request->user(), $uuid);

        return response()->json(['application' => $this->record($application)]);
    }

    /**
     * The filed passport photo at the resolution it was filed in.
     *
     * Scoped through the application, not the person: whoever may read the
     * application may see who it is for, and nobody else may — a uuid in the
     * URL is not an argument for showing someone's face.
     */
    public function passportPhoto(Request $request, string $uuid)
    {
        $person = CipPerson::query()->where('uuid', $uuid)->firstOrFail();
        ApplicationScope::findOrFail($request->user(), $person->application->uuid);

        $photo = PassportPhoto::read($person);
        abort_unless($photo, 404);

        return response($photo['body'], 200, [
            'Content-Type' => $photo['mime'],
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }

    private function record($application): array
    {
        $application->loadMissing(['provider', 'people.documents']);
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $sponsor = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR);
        $dependents = $application->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->sortBy('dependent_ordinal')
            ->values();

        return [
            'id' => $application->uuid,
            // §7: the internal number until the CIP number takes over.
            'number' => $application->displayNumber(),
            'internalNumber' => $application->internal_number,
            'cipNumber' => $application->cip_number,
            'status' => $application->status,
            'statusLabel' => Status::label($application->status),
            'statusTone' => Status::tone($application->status),
            'provider' => $application->provider?->name,
            'providerCode' => $application->provider?->code,
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            'sponsored' => (bool) $application->sponsored,
            'familySize' => $application->familySize(),
            'familyLabel' => $application->familyLabel(),
            'applicant' => $main ? $this->person($main) : null,
            'sponsor' => $sponsor ? $this->person($sponsor) : null,
            'dependents' => $dependents->map(fn (CipPerson $p) => $this->person($p))->all(),
            'createdAt' => $application->created_at?->toIso8601String(),
        ];
    }

    /**
     * One individual, with their checklist.
     *
     * The same shape whoever it is — the caller already knows which role it
     * asked for, and a sponsor that described itself differently from an
     * applicant would mean two ways to read the same person.
     */
    private function person(CipPerson $person): array
    {
        return [
            'id' => $person->uuid,
            'role' => $person->role,
            'label' => Dependents::label($person),
            'relationship' => $person->relationship,
            'dependentOrdinal' => $person->dependent_ordinal,
            'name' => $person->fullName(),
            'gender' => $person->gender,
            'dateOfBirth' => $person->date_of_birth?->toDateString(),
            'countryOfBirth' => $person->country_of_birth,
            'countryOfResidence' => $person->country_of_residence,
            'region' => $person->region,
            'occupation' => $person->occupation,
            'passportNumber' => $person->passport_number,
            // The passport photo, doubling as the avatar every list draws.
            'photo' => $person->photoUrl(),
            'passportPhotoUrl' => $person->photo_path
                ? '/portal/cip/people/'.$person->uuid.'/passport-photo'
                : null,
            'documents' => $person->documents->map(fn ($slot) => [
                'type' => $slot->type,
                'label' => $slot->label,
                'required' => (bool) $slot->required,
                'uploaded' => $slot->isFilled(),
            ])->values()->all(),
            'outstanding' => DocumentSlots::outstanding($person),
        ];
    }
}
