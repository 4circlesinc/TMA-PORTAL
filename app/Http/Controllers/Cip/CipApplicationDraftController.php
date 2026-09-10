<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Intake;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use App\Support\Files\FolderTree;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The intake wizard's autosave: a real application, saved as it is typed.
 *
 * A DRAFT ROW, NOT A NOTE ABOUT ONE
 *
 * The unfinished application is an application from the first keystroke. It
 * sits in the applications table with everything else, wearing a Draft chip
 * and its own internal number, and filing it is a status change rather than a
 * second act of creation. That is what makes a draft something the firm can
 * see and refer to — "GAL26-00007, the one Amara started on Tuesday" — rather
 * than a private note that only exists until somebody's laptop shuts.
 *
 * DRAFT IS THE WHOLE VOCABULARY, AND THE ONLY WAY OUT IS TO FILE IT
 *
 * Status::listed() has never included DRAFT, so the picker on a draft row
 * offers nothing: it is not a status somebody may set, and the one edge out
 * of it — DRAFT to NEW — belongs to the submit verb, which checks the
 * applicant's documents first. A draft therefore cannot be walked into the
 * middle of the lifecycle by hand, which is the point: an application that
 * has never been completed has no business being marked Ready to submit.
 *
 * WHAT IS AND IS NOT VALIDATED
 *
 * Nothing is required, because "not filled in yet" is the ordinary state of a
 * draft. Shape still is: a malformed date or a country that is not on the
 * list would be wrong however unfinished the form is. The filing step asks
 * the real questions, where a reader can still do something about the answer.
 *
 * IT KEEPS ITS SCANS, AND THROWING IT AWAY RECYCLES THEM
 *
 * A draft held answers only at first, on the reasoning that an unfiled
 * application should not put an unreviewed document in a client's folders.
 * That cost more than it saved: a reader who uploaded six passports and shut
 * the tab lost the part of the work that took longest. The scans are kept
 * now, in the same folders and slots a filed application uses, because a
 * draft IS the application and a second home would only have to be moved
 * later.
 *
 * The folder question is answered at the other end instead. Discarding a
 * draft removes the form outright — nobody refers to an unfiled one — and
 * soft-deletes its folder, so the paper sits in the recycle bin and a reader
 * who threw away the wrong draft can get it back.
 */
class CipApplicationDraftController extends Controller
{
    /** The draft to reopen, or nothing when there is none to reopen. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $draft = $this->mine($request);

        return response()->json(['draft' => $draft ? $this->answers($draft) : null]);
    }

    /**
     * Keep what has been typed so far.
     *
     * One draft per reader per phase, so a reader who opens the wizard twice
     * carries on with the same unfinished application rather than numbering a
     * second one. The wizard sends the whole form each time, so this is a
     * replace rather than a merge — a dependant removed on the screen has to
     * be removed here too.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        /*
         * One scan on its own is still a list of one.
         *
         * The wizard posts `passportBioPage[]`, but a slot holding a single
         * file arrives as a bare upload, and the rules below expect an array
         * — so without this the file failed its rule and was quietly dropped
         * while the photo, which is not a list, went through. The reader saw
         * a draft that had kept the photo and still demanded every document.
         */
        Intake::normaliseDocuments($request);

        $data = $request->validate(Intake::draftRules(), Intake::messages());
        $draft = $this->mine($request);

        /*
         * Nothing typed is nothing to keep.
         *
         * The wizard fills the provider in for itself when a reader can only
         * file under one firm, so an untouched form is not empty — and a
         * numbered row for a form nobody has begun is a row somebody has to
         * explain. Emptying a form is also how a reader abandons one, so this
         * discards the draft rather than saving it.
         */
        if (! $this->hasAnswers($data)) {
            if ($draft) {
                $this->discard($draft, $user);
            }

            return response()->json(['draft' => null]);
        }

        $provider = Intake::providersFor($user)->firstWhere('uuid', $data['providerId']);
        abort_unless($provider, 422, 'Choose a service provider you can file under.');

        $draft = $draft
            ? Intake::updateDraft($draft, $user, $data)
            : Intake::createDraft($provider, $user, $data);

        // The table shows drafts, so it has to hear about them.
        Live::staff(Live::CIP);

        return response()->json(['draft' => $this->answers($draft)]);
    }

    /** The reader threw the form away. */
    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        if ($draft = $this->mine($request)) {
            $this->discard($draft, $user);
            Live::staff(Live::CIP);
        }

        return response()->json(['draft' => null]);
    }

    /**
     * This reader's unfinished application for this phase.
     *
     * Scoped to the creator, not to who may see it. A draft is visible in the
     * table to everyone the application scope allows, but it is only ever
     * RESUMED by the person typing it: two readers sharing one half-typed
     * form would overwrite each other on every keystroke.
     */
    private function mine(Request $request): ?CipApplication
    {
        $user = $request->user();

        /*
         * A reopened draft names itself, and that answer is exact.
         *
         * Without it the save would land on whatever this reader's newest
         * draft of the phase happened to be, so a draft opened from the table
         * would be written over the top of a different one — and two tabs
         * would fight. A uuid that is not this reader's own draft matches
         * nothing rather than falling back to one, because silently writing
         * somebody's answers into another row is the worst outcome here.
         */
        $uuid = (string) ($request->input('application') ?? $request->query('application', ''));
        if ($uuid !== '') {
            return CipApplication::query()
                ->where('uuid', $uuid)
                ->where('status', Status::DRAFT)
                ->where('created_by', $user->id)
                ->with('people')
                ->first();
        }

        $phase = (string) ($request->input('phase') ?? $request->query('phase', ''));
        $phase = $phase === Phase::POST_APPROVAL ? Phase::POST_APPROVAL : Phase::PRE_APPROVAL;

        return CipApplication::query()
            ->where('status', Status::DRAFT)
            ->where('created_by', $user->id)
            ->where('phase', $phase)
            ->with('people')
            ->latest('id')
            ->first();
    }

    /**
     * Throw a draft away for good.
     *
     * A hard delete, unlike every other application, and deliberately: the
     * recycle bin is for work somebody did, and an abandoned half-filled form
     * that a reader explicitly discarded is not something anybody should have
     * to find and empty later. Nothing else points at it — a draft has no
     * folders, no documents and no assignments.
     */
    private function discard(CipApplication $draft, ?User $actor = null): void
    {
        /*
         * The folder goes to the recycle bin, not with it.
         *
         * A draft keeps its scans now, so throwing one away throws away
         * documents — and a reader who deletes the wrong draft has lost six
         * passports with no way back. The application and its people are
         * removed outright, because an unfiled form is not a record anybody
         * refers to; the paper is soft-deleted, so it can be restored from
         * the bin like anything else.
         */
        foreach ($this->foldersOf($draft) as $folder) {
            FolderTree::softDeleteTree($folder, $actor?->id ?? $draft->created_by);
        }

        $draft->people()->forceDelete();
        $draft->forceDelete();
    }

    /**
     * Every folder this draft owns, deepest first.
     *
     * The application's own folder covers the people inside it, but a person
     * whose folder was provisioned before the tree existed can sit outside
     * it, so both are collected rather than assuming the shape.
     *
     * @return list<Folder>
     */
    private function foldersOf(CipApplication $draft): array
    {
        $ids = $draft->people()->pluck('folder_id')->all();
        $ids[] = $draft->folder_id;
        $ids[] = $draft->post_approval_folder_id;

        $ids = array_values(array_unique(array_filter($ids)));

        if ($ids === []) {
            return [];
        }

        return Folder::query()->whereIn('id', $ids)->get()->all();
    }

    /**
     * The document field names this draft already has a file for, in the same
     * dotted paths the form keys its controls on.
     *
     * @param  Collection<int, CipPerson>  $dependents
     * @return list<string>
     */
    private function filedSlots(CipApplication $draft, $dependents): array
    {
        $paths = [];

        $of = function (?CipPerson $person, string $prefix) use (&$paths) {
            if (! $person) {
                return;
            }

            if ($person->photo_path) {
                $paths[] = $prefix.'passportPhoto';
            }

            foreach ($person->documents()->whereNotNull('file_id')->pluck('type') as $type) {
                $paths[] = $prefix.Str::camel($type);
            }
        };

        $of($draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT), '');
        $of($draft->people->firstWhere('role', CipPerson::ROLE_SPONSOR), 'sponsor.');

        foreach ($dependents as $i => $dependent) {
            $of($dependent, 'dependents.'.$i.'.');
        }

        return array_values(array_unique($paths));
    }

    /**
     * Passport-photo URLs already stored on this draft, keyed like the form.
     *
     * @param  Collection<int, CipPerson>  $dependents
     * @return array<string, string>
     */
    private function photoPreviews(CipApplication $draft, $dependents): array
    {
        $urls = [];

        $of = function (?CipPerson $person, string $prefix) use (&$urls) {
            if (! $person?->photo_path) {
                return;
            }

            $urls[$prefix.'passportPhoto'] = '/portal/cip/people/'.$person->uuid.'/passport-photo?v='
                .substr(md5($person->photo_path.'|'.($person->updated_at?->getTimestamp() ?? 0)), 0, 8);
        };

        $of($draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT), '');
        $of($draft->people->firstWhere('role', CipPerson::ROLE_SPONSOR), 'sponsor.');

        foreach ($dependents as $i => $dependent) {
            $of($dependent, 'dependents.'.$i.'.');
        }

        return $urls;
    }

    /** Did the reader type anything the provider was not filled in for them? */
    private function hasAnswers(array $data): bool
    {
        foreach ($data as $key => $value) {
            if (in_array($key, ['providerId', 'phase', 'submissionId'], true)) {
                continue;
            }
            if (is_array($value)) {
                if ($this->hasAnswers($value)) {
                    return true;
                }

                continue;
            }
            if ($value !== null && trim((string) $value) !== '' && $value !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * The draft, in the shape the wizard's own fields are keyed by.
     *
     * Deliberately the form's vocabulary rather than the application record:
     * this answer is poured straight back into the controls, so it speaks
     * `sponsor.firstName` and `dependents.0.dateOfBirth` the way every other
     * part of the wizard does.
     *
     * @return array<string, mixed>
     */
    private function answers(CipApplication $draft): array
    {
        $draft->loadMissing('people');
        $answers = [];

        $person = function (?CipPerson $p, string $prefix) use (&$answers) {
            if (! $p) {
                return;
            }
            foreach ([
                'firstName' => 'first_name',
                'lastName' => 'last_name',
                'gender' => 'gender',
                'countryOfBirth' => 'country_of_birth',
                'countryOfResidence' => 'country_of_residence',
                'occupation' => 'occupation',
                'passportNumber' => 'passport_number',
            ] as $field => $column) {
                if (($value = $p->{$column}) !== null && $value !== '') {
                    $answers[$prefix.$field] = (string) $value;
                }
            }
            // A date column comes back as a Carbon; the form wants the day.
            if ($p->date_of_birth) {
                $answers[$prefix.'dateOfBirth'] = $p->date_of_birth->format('Y-m-d');
            }
        };

        $person($draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT), '');

        if ($draft->sponsored) {
            $answers['sponsored'] = '1';
            $person($draft->people->firstWhere('role', CipPerson::ROLE_SPONSOR), 'sponsor.');
        }

        $dependents = $draft->people
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->sortBy(fn (CipPerson $p) => $p->dependent_ordinal ?? $p->id)
            ->values();

        foreach ($dependents as $i => $dependent) {
            $person($dependent, 'dependents.'.$i.'.');
            // The uuid rides along so the next save changes this dependant
            // rather than replacing the family with a new one.
            $answers['dependents.'.$i.'.id'] = $dependent->uuid;
            if ($dependent->relationship) {
                $answers['dependents.'.$i.'.relationship'] = $dependent->relationship;
            }
        }

        if ($draft->investment_type) {
            $answers['investmentType'] = $draft->investment_type;
        }
        if ($draft->investment_type_other) {
            $answers['investmentTypeOther'] = $draft->investment_type_other;
        }
        $answers['providerId'] = $draft->provider?->uuid ?? '';

        return [
            'id' => $draft->uuid,
            'number' => $draft->internal_number,
            'phase' => $draft->phase,
            'answers' => $answers,
            'dependents' => $dependents->count(),
            /*
             * Which slots already hold a scan, so the resumed form marks them
             * answered and the notice names only what is genuinely still
             * missing. Without this every document read as absent and the
             * reader was told to choose six files that were sitting there.
             */
            'filed' => $this->filedSlots($draft, $dependents),
            /*
             * The faces already kept, so the photo control can show them
             * rather than an empty box beside "the field is required".
             */
            'previews' => $this->photoPreviews($draft, $dependents),
            'savedAt' => $draft->updated_at?->toIso8601String(),
        ];
    }
}
