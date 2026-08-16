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
use App\Support\Cip\Submission;
use App\Support\Files\Presenter;
use App\Support\Realtime\Live;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

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
    /*
     * How many applications one sync page carries.
     *
     * Each is a whole family with their checklists, so this is not a cheap
     * row — and a first sync of the firm's whole book is a lot of them. Small
     * enough that a page answers before a phone gives up on it, large enough
     * that catching up after a week is not two hundred round trips.
     */
    private const SYNC_PAGE = 50;

    /** Rows in one page of the main application table (§8). */
    private const LIST_PAGE = 50;

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

    /**
     * Everything that has changed since the caller last asked.
     *
     * The pull half of working offline (docs/offline-plan.md, phase 2). A
     * device that has been on a plane comes back, replays what it queued, and
     * then asks this for whatever moved while it was away — so the cached
     * copy on the desktop is brought up to date without re-downloading eleven
     * thousand records.
     *
     * THE CURSOR IS A PAIR, AND HAS TO BE
     *
     * `updated_at` alone cannot page: two applications saved in the same
     * second straddling a page boundary means either one is served twice or
     * one is never served at all, and the second is a record that stays
     * silently wrong on somebody's laptop. So the cursor is the timestamp AND
     * the id, and the next page is "later than that timestamp, or the same
     * timestamp with a higher id".
     *
     * NO CURSOR MEANS EVERYTHING
     *
     * A first run has nothing to catch up from, so it walks the whole set a
     * page at a time — the same loop, no separate download path to keep in
     * step with this one.
     */
    public function sync(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $since = $this->cursorTime($request->query('since'));
        $after = (int) $request->query('after', 0);

        $query = ApplicationScope::query($user)
            ->with(['provider', 'people.documents.file']);

        if ($since !== null) {
            /*
             * `>=` on the id tie-break: the row the cursor ended on comes
             * again while its timestamp equals the cursor's, because it can
             * change AGAIN inside that instant and strictly-greater would
             * skip the second change for ever. One re-delivered record per
             * walk, absorbed by the upsert — same rule as the files cursor.
             */
            $query->where(function (Builder $q) use ($since, $after) {
                $q->where('updated_at', '>', $since)
                    ->orWhere(fn (Builder $same) => $same
                        ->where('updated_at', '=', $since)
                        ->where('id', '>=', $after));
            });
        }

        $page = $query
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(self::SYNC_PAGE)
            ->get();

        $last = $page->last();

        return response()->json([
            'applications' => $page->map(fn ($application) => $this->record($application, $user))->all(),
            /*
             * Where to carry on from. The caller stores this and hands it back
             * next time; it is deliberately opaque prose-free data rather than
             * a page number, because a page number means something different
             * the moment a row is written.
             */
            'cursor' => [
                'since' => $last ? $last->updated_at?->toIso8601String() : $request->query('since'),
                'after' => $last ? $last->id : $after,
            ],
            // A full page probably is not the end of the set. Saying so is
            // cheaper than a count over a scoped query that may be large.
            'more' => $page->count() === self::SYNC_PAGE,
        ]);
    }

    /**
     * A cursor timestamp, or null.
     *
     * An unparseable `since` is treated as no cursor at all rather than as an
     * error: the worst case is one device re-reading a page it already has,
     * and the alternative is a client that can never recover from a corrupt
     * value it stored itself.
     */
    private function cursorTime(?string $value): ?CarbonImmutable
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        try {
            return CarbonImmutable::parse($value);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The main application table (§8).
     *
     * Its own endpoint rather than a widening of the client directory, for two
     * reasons. The directory answers with every client the reader may see —
     * eleven thousand of them — and pages in the browser; hanging an
     * application, its provider, its officer and a head-count off each of
     * those rows is the shape that put the container out of memory once
     * already. And the table lists applications, not clients: a client with no
     * application does not belong in it, and a client with two would appear
     * once.
     *
     * Paged on the server, and every column is either a column of the row or
     * an eager-loaded relation — no per-row query. Family size in particular
     * is `withCount`, because §8 puts it on every line and `people()->count()`
     * would be one query per application to answer it.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);

        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:120'],
            'status' => ['nullable', 'string', 'max:32'],
            'page' => ['nullable', 'integer', 'min:1'],
            'perPage' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        $perPage = (int) ($data['perPage'] ?? self::LIST_PAGE);

        $query = ApplicationScope::query($user)
            ->with([
                'provider:id,uuid,name,code',
                'client:id,uid,name,email,phone',
                'assignedOfficer:id,name,email,avatar_url',
                // Only the main applicant: the table shows one name, and
                // loading a whole family per row to read it would be six times
                // the rows for one column.
                'people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
            ])
            ->withCount('people');

        if (! empty($data['status']) && Status::isValid($data['status'])) {
            $query->where('status', $data['status']);
        }

        $this->applyListSearch($query, trim($data['q'] ?? ''));

        $page = $query
            // Newest first: the table is a worklist, and the application filed
            // this morning is the one somebody is looking for.
            ->orderByDesc('id')
            ->paginate($perPage, ['*'], 'page', $data['page'] ?? 1);

        return response()->json([
            'applications' => collect($page->items())->map(fn ($a) => $this->row($a))->all(),
            'page' => $page->currentPage(),
            'lastPage' => $page->lastPage(),
            'perPage' => $page->perPage(),
            'total' => $page->total(),
            'statuses' => collect(Status::ALL)->map(fn (string $s) => [
                'value' => $s,
                'label' => Status::label($s),
                'tone' => Status::tone($s),
            ])->all(),
        ]);
    }

    /**
     * §7's search, on the table it lists: either number, or the applicant.
     *
     * The numbers are matched from the start — a number is typed to find one
     * record — while a name is matched anywhere, because people search on a
     * surname as readily as a first name.
     */
    private function applyListSearch($query, string $term): void
    {
        if ($term === '') {
            return;
        }

        $prefix = mb_strtolower(addcslashes($term, '\\%_')).'%';
        $anywhere = '%'.mb_strtolower(addcslashes($term, '\\%_')).'%';

        $query->where(function (Builder $q) use ($prefix, $anywhere) {
            $q->whereRaw('LOWER(cip_applications.internal_number) LIKE ?', [$prefix])
                ->orWhereRaw('LOWER(cip_applications.cip_number) LIKE ?', [$prefix])
                ->orWhereHas('client', fn (Builder $c) => $c
                    ->whereRaw('LOWER(clients.name) LIKE ?', [$anywhere]))
                ->orWhereHas('people', fn (Builder $p) => $p
                    ->whereRaw("LOWER(first_name || ' ' || last_name) LIKE ?", [$anywhere]));
        });
    }

    /**
     * One row of §8, and only what §8 asks for.
     *
     * Deliberately not {@see record()}: that is the whole application with
     * every person and their checklists, which is the right answer for a
     * profile and a hundred times too much for a table of fifty lines.
     */
    private function row($application): array
    {
        $main = $application->people->first();
        $client = $application->client;
        $officer = $application->assignedOfficer;

        return [
            'id' => $application->uuid,
            'clientUid' => $client?->uid,
            // §7: the CIP number once it exists, the internal one until then.
            'number' => $application->displayNumber(),
            'internalNumber' => $application->internal_number,
            'cipNumber' => $application->cip_number,
            'applicantName' => $main
                ? trim($main->first_name.' '.$main->last_name)
                : ($client?->name ?? '—'),
            'provider' => $application->provider?->name,
            /*
             * Who to contact about this application.
             *
             * The client record's own contact, which for a provider-referred
             * application is the person the firm deals with there and for a
             * private client is the applicant. Not `unit_contact` — that is
             * the government's officer, a different question that §8 does not
             * ask on this row.
             */
            'contactPerson' => $client?->name,
            'contactEmail' => $client?->email,
            'investmentType' => InvestmentType::display(
                $application->investment_type,
                $application->investment_type_other,
            ),
            // "1 Main Applicant + 1 Sponsor + 4 Dependents = F6" (§8).
            'familySize' => (int) $application->people_count,
            'familyLabel' => 'F'.max(1, (int) $application->people_count),
            'status' => $application->status,
            'statusLabel' => Status::label($application->status),
            'statusTone' => Status::tone($application->status),
            'assignedTo' => $officer ? [
                'name' => $officer->name,
                'email' => $officer->email,
                'avatar' => $officer->avatar_url,
            ] : null,
        ];
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
     * The Unit has it: record the date and the CIP number (§16, §7).
     *
     * The number is the point. Every surface renders `displayNumber()`, so
     * writing it here is what flips dashboards, reports, status screens, email
     * subjects and search off the internal number in one move.
     *
     * The capability is not checked here on purpose. Submission is a status
     * change and {@see Engine} owns those — it refuses the edge from anywhere
     * but Ready to submit, and refuses the actor without `cip.compliance`.
     * A second check in the controller would be a second place to get it wrong.
     */
    public function submit(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'cipNumber' => ['required', 'string', 'max:'.Submission::MAX_LENGTH],
            // Recorded, not assumed: staff enter a submission after the fact
            // as often as on the day, and defaulting silently to today would
            // put the wrong date on an audit trail.
            'submittedAt' => ['nullable', 'date'],
        ], [
            'cipNumber.required' => 'Enter the CIP application number from the Unit.',
        ]);

        $application = Submission::record(
            $application,
            $user,
            $data['cipNumber'],
            isset($data['submittedAt']) ? Carbon::parse($data['submittedAt']) : null,
        );

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /** Fix a CIP number that was typed wrong. The status does not move. */
    public function correctNumber(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'cipNumber' => ['required', 'string', 'max:'.Submission::MAX_LENGTH],
        ]);

        $application = Submission::correct($application, $user, $data['cipNumber']);

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
        $application->loadMissing(['provider', 'client', 'people.documents.file']);

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
            // Which client's profile this belongs under, and when it last
            // moved. Both are for the offline cache: a record arriving from
            // the sync cursor has to be filed where the profile will look for
            // it, and a screen showing a copy has to be able to tell whether
            // what it holds is older than what just arrived.
            'clientUid' => $application->client?->uid,
            'updatedAt' => $application->updated_at?->toIso8601String(),
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
