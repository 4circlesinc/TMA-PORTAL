<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Countries;
use App\Support\Cip\Dependents;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Intake;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\PassportPhoto;
use App\Support\Cip\Status;
use App\Support\Files\Presenter;
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

        // A requirement takes a list of files; one file on its own still counts
        // as a list of one.
        Intake::normaliseDocuments($request);

        $data = $request->validate(Intake::rules(), Intake::messages());

        // A provider this account may not file under is not offered and not
        // accepted — the same list the form was drawn from decides.
        $provider = Intake::providersFor($user)->firstWhere('uuid', $data['providerId']);
        abort_unless($provider, 422, 'Choose a service provider you can file under.');

        $application = Intake::create($provider, $user, $data);

        Live::staff(Live::CIP);

        return response()->json([
            'application' => $this->record($application, $user),
        ], 201);
    }

    /** One application, if this reader may see it. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $application = ApplicationScope::findOrFail($request->user(), $uuid);

        return response()->json([
            'application' => $this->record($application, $request->user()),
        ]);
    }

    /**
     * The application a client's profile is showing.
     *
     * Answered as null rather than 404 when there is none: a client can exist
     * without one — imported, or created by hand — and the profile asking
     * "which application is this person's" deserves "none yet" rather than an
     * error it has to special-case.
     */
    public function forClient(Request $request, string $uid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        /*
         * Scoped on the application, not the client.
         *
         * ClientScope answers "may you see this client", which is about hub
         * assignments and would refuse an officer looking at an application
         * they are perfectly entitled to work on. What governs here is CIP
         * reach, and ApplicationScope is what holds it — an application this
         * reader may not see comes back as none, which is what they would be
         * told anyway.
         */
        $client = Client::where('uid', $uid)->firstOrFail();

        $application = ApplicationScope::query($user)
            ->where('client_id', $client->id)
            ->latest('id')
            ->first();

        return response()->json([
            'application' => $application ? $this->record($application, $user) : null,
        ]);
    }

    /**
     * Change one.
     *
     * The same body the form posts to create, because it is the same form —
     * see Intake::update for what happens to the people already on it.
     */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);
        abort_unless(CipAccess::canCreate($user), 404);

        Intake::normaliseDocuments($request);
        $data = $request->validate(Intake::rules(editing: true), Intake::messages());

        $application = Intake::update($application, $user, $data);

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
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

    private function record($application, User $viewer): array
    {
        // The slots' files as well as the slots: the checklist only needs to
        // know a slot is answered, but the passport photo is opened from here.
        $application->loadMissing(['provider', 'people.documents.file']);

        /*
         * One presenter for the whole family, primed once.
         *
         * Presenter::file() rolls up shares, review status and favourites,
         * and unprimed it does that per file — six people would be six sets
         * of the same queries. Priming asks once for all of them.
         */
        $photos = $application->people
            ->map(fn (CipPerson $p) => $this->photoFileModel($p))
            ->filter()
            ->values()
            ->all();

        $presenter = new Presenter($viewer);
        $presenter->prime($photos, []);

        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $sponsor = $application->people->firstWhere('role', CipPerson::ROLE_SPONSOR);
        // Numbered first and in their number, then the unnumbered — a spouse
        // carries no ordinal, and sorting on the column alone put null first,
        // so the family read Spouse, QD1, QD2 instead of the other way round.
        $dependents = $application->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->sortBy(fn (CipPerson $p) => ($p->dependent_ordinal ?? 9999) * 1000000 + $p->id)
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
            'providerId' => $application->provider?->uuid,
            'providerCode' => $application->provider?->code,
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            // The stored values, for a form that has to put the record back
            // into its own controls — `investmentType` above is the display
            // string, which is the free text once somebody picked Other.
            'investmentTypeValue' => $application->investment_type,
            'investmentTypeOther' => $application->investment_type_other,
            'sponsored' => (bool) $application->sponsored,
            'familySize' => $application->familySize(),
            'familyLabel' => $application->familyLabel(),
            'applicant' => $main ? $this->person($main, $presenter) : null,
            'sponsor' => $sponsor ? $this->person($sponsor, $presenter) : null,
            'dependents' => $dependents->map(fn (CipPerson $p) => $this->person($p, $presenter))->all(),
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
    private function person(CipPerson $person, Presenter $presenter): array
    {
        $photoFile = $this->photoFileModel($person);

        return [
            'id' => $person->uuid,
            'role' => $person->role,
            'label' => Dependents::label($person),
            'relationship' => $person->relationship,
            'dependentOrdinal' => $person->dependent_ordinal,
            'name' => $person->fullName(),
            // Both halves as well as the whole: the form asks for them
            // separately, and splitting a full name back apart guesses wrong
            // on everyone whose surname is two words.
            'firstName' => $person->first_name,
            'lastName' => $person->last_name,
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
            /*
             * The photo as it was filed, in the File Library's own shape.
             *
             * It IS a library file — DocumentSlots puts it in the person's
             * folder through Vault like every other document — so opening it
             * opens the library's viewer, with the comments, versions, review
             * and sharing that come with it. That viewer reads a whole file
             * row, so this is the same row the library would have handed it,
             * built by the same presenter rather than a hand-rolled subset
             * that would quietly lose a button.
             */
            'photoFile' => $photoFile ? $presenter->file($photoFile) : null,
            'documents' => $person->documents->map(fn ($slot) => [
                'type' => $slot->type,
                'label' => $slot->label,
                'required' => (bool) $slot->required,
                'uploaded' => $slot->isFilled(),
            ])->values()->all(),
            'outstanding' => DocumentSlots::outstanding($person),
        ];
    }

    /** The file filling this person's passport-photo slot, if it is filled. */
    private function photoFileModel(CipPerson $person): ?FileItem
    {
        return $person->documents
            ->firstWhere('type', DocumentTypes::PASSPORT_PHOTO)?->file;
    }
}
