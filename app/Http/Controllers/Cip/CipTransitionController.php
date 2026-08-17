<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Decision;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use App\Support\Cip\Submission;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Moving an application through its lifecycle (§6).
 *
 * {@see Engine} has held the map and the rules since phase 1; this is the door
 * to them. One endpoint drives any edge, because the lifecycle is one machine
 * and a verb per status would be twelve places for the map to be read slightly
 * differently. Submission has a verb of its own only because it carries a
 * precondition the others do not.
 *
 * NOTHING HERE RE-ASKS WHAT THE ENGINE ALREADY ANSWERS
 *
 * The engine refuses an edge that is not in the lifecycle and an actor without
 * the capability for it, in the same transaction that would have written the
 * row. Repeating either check here would be a second copy to drift out of step
 * with the first, so the controller's whole job is to resolve the application,
 * hand the move over, and give the engine's refusal an HTTP shape.
 *
 * Reach is the exception, and is not a duplicate: ApplicationScope answers
 * whether this reader may see the application at all, which the engine does
 * not ask — and answers 404 rather than 403, the portal's convention, so a
 * stranger cannot learn an application exists by being refused it.
 */
class CipTransitionController extends Controller
{
    /**
     * Drive one transition.
     *
     * The status is taken as given and passed straight to the engine, invalid
     * values included: `isValid` is part of `canTransition`, and validating
     * the vocabulary here would be the same question asked twice with two
     * different answers to maintain.
     */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'status' => ['required', 'string', 'max:32'],
            // Why it moved, in the mover's words. It rides in the event meta
            // rather than a column: it belongs to one transition, not to the
            // application, and the next move has its own reason.
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $this->refuseIfItHasItsOwnVerb($application, $data['status']);

        $note = trim($data['note'] ?? '');
        $meta = $note === '' ? [] : ['note' => $note];

        $application = $this->drive($application, $data['status'], $user, $meta);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * Some edges are not this endpoint's to drive.
     *
     * The generic endpoint exists for the transitions that are only a change of
     * state. Three are not: they carry work the state alone does not capture,
     * and each already has a verb that does it properly. Left open, this route
     * was a way to skip every one of those preconditions — which made the
     * guards in the other verbs decorative rather than binding.
     *
     *  - NEW is submit(), which refuses a leftover draft whose main applicant
     *    still owes required documents. Reachable from here, an unassessable
     *    application lands in the officers' queue and §14's first read cannot
     *    begin. New files already start at NEW, so this door is only for rows
     *    that have not yet been moved.
     *  - PENDING REVIEW is {@see Submission::record()}, which
     *    records the CIP number and the submission date. Driven bare, §7's
     *    dual-numbering rule fails silently — every surface goes on showing the
     *    internal number for an application the Unit already holds — and since
     *    there is no edge back, the proper door is then shut for good.
     *  - GRANTED and DENIED are phase 8's decision, which writes `decision` and
     *    `decided_at`. Both are terminal, so a bare transition leaves those
     *    columns null with no way back to fill them, and any report measured
     *    from the decision date is quietly wrong for ever.
     */
    private function refuseIfItHasItsOwnVerb(CipApplication $application, string $status): void
    {
        if ($status === Status::NEW && $application->status === Status::DRAFT) {
            abort(422, 'Use the submit verb to file a leftover draft — it checks the applicant\'s documents first.');
        }

        if ($status === Status::PENDING_REVIEW && $application->status === Status::READY_TO_SUBMIT) {
            abort(422, 'Record the submission instead, so the CIP number and the date go with it.');
        }

        if ($status === Status::GRANTED || $status === Status::DENIED) {
            abort(422, 'Record the decision instead, so the outcome and its date are stored.');
        }
    }

    /**
     * File a leftover draft: Draft → New Applications (§6).
     *
     * New files start at NEW, so this door is only for rows that have not yet
     * been moved. Its own endpoint because of the guard below, and open to the
     * application's creator as well as to `cip.create` — the provider side and
     * the private client both file their own leftovers, and neither holds a
     * matrix capability. That grant lives in {@see Engine::allows()}, where the
     * rest of the lifecycle's permissions are.
     */
    public function submit(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $outstanding = $this->outstanding($application);

        /*
         * A draft that cannot be assessed is not a submission.
         *
         * The first read of a file is made against the main applicant's own
         * required documents, so an application arriving without them is work
         * nobody can start — it would go straight back out as an update
         * request. They are named rather than counted because the person
         * submitting is usually the person who has to go and find them, and
         * the list also comes back as data so the checklist can mark them
         * without parsing the sentence.
         *
         * Checked before the engine is asked to move anything, not after:
         * {@see Engine::apply()} moves the row and writes the audit event in
         * one transaction, and a refusal that had to unwind a completed
         * transition would be a refusal that had already happened.
         */
        if ($outstanding !== []) {
            return response()->json([
                'message' => 'This application is missing the main applicant’s '.Arr::join($outstanding, ', ', ' and ').'.',
                'outstanding' => $outstanding,
            ], 422);
        }

        $application = $this->drive($application, Status::NEW, $user, []);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /**
     * Record the Unit's decision: Approved or Denied (§21).
     *
     * Its own endpoint because of the columns below, and open only to
     * `cip.decide` — that grant lives in {@see Engine::allows()}, where the
     * rest of the lifecycle's permissions are. The generic status route
     * refuses both targets so a bare move cannot leave `decision` and
     * `decided_at` null on a terminal file.
     */
    public function decide(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = ApplicationScope::findOrFail($user, $uuid);

        $data = $request->validate([
            'decision' => ['required', 'string', Rule::in([Status::GRANTED, Status::DENIED])],
            // Recorded, not assumed: a decision letter is dated, and staff
            // enter it after the fact as often as on the day.
            'decidedAt' => ['nullable', 'date'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        try {
            $application = Decision::record(
                $application,
                $user,
                $data['decision'],
                isset($data['decidedAt']) ? Carbon::parse($data['decidedAt']) : null,
                trim($data['note'] ?? ''),
            );
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        Live::staff(Live::CIP);

        return response()->json(['application' => $this->record($application, $user)]);
    }

    /* ── internals ─────────────────────────────────── */

    /**
     * Hand the move to the engine, and translate its refusal.
     *
     * A mapped edge goes through {@see Engine::apply()}; any other listed
     * status goes through {@see Engine::set()}, which is what the picker
     * uses when it names a status that is not the next one in the lifecycle.
     * An unlisted value is the caller's mistake and so a 422. The
     * authorisation failure is deliberately not caught: Laravel already
     * renders it as a 403 carrying the engine's own wording.
     */
    private function drive(CipApplication $application, string $to, ?User $actor, array $meta): CipApplication
    {
        try {
            $application = Engine::canTransition($application, $to)
                ? Engine::apply($application, $to, $actor, $meta)
                : Engine::set($application, $to, $actor, $meta);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        // Colleagues watching the table or this application see the move
        // without reloading — the same signal every other CIP write sends.
        Live::staff(Live::CIP);

        return $application;
    }

    /**
     * The main applicant's required documents that are still empty.
     *
     * Only the main applicant. A family's dependants keep producing paperwork
     * while the applicant's own file is being read, and holding the whole
     * submission at the door for a child's birth certificate would stop the
     * review that would have asked for it.
     *
     * An application with nobody on it yet owes nothing, which is honest: the
     * checklist is a person's, so there is no checklist to be short of.
     *
     * @return array<int, string>
     */
    private function outstanding(CipApplication $application): array
    {
        $main = $application->people()
            ->where('role', CipPerson::ROLE_MAIN_APPLICANT)
            ->first();

        return $main ? DocumentSlots::outstanding($main) : [];
    }

    /**
     * The application as a status screen reads it back.
     *
     * Deliberately not the whole record — that is what
     * {@see CipApplicationController::show()} answers, with every person and
     * their checklists, and a transition moves none of it. What a caller needs
     * from here is where the application now is, what it is called, and what
     * it may be moved to next.
     *
     * The next moves are the actor's, not the application's: the same
     * application offers a Reviewing Officer two choices and a Compliance
     * Officer none, so a screen drawn from this cannot show a button its
     * reader would be refused.
     *
     * @return array<string, mixed>
     */
    private function record(CipApplication $application, ?User $actor): array
    {
        return [
            'id' => $application->uuid,
            // §7: the CIP number once it exists, the internal one until then.
            'number' => $application->displayNumber(),
            'status' => $application->status,
            'statusLabel' => Status::label($application->status),
            'statusTone' => Status::tone($application->status),
            'availableTransitions' => collect(Engine::availableTransitions($application, $actor))
                ->map(fn (string $status) => [
                    'value' => $status,
                    'label' => Status::label($status),
                    'tone' => Status::tone($status),
                ])->all(),
            // A screen holding an older copy has to be able to tell that this
            // one is newer, the same way the offline cache does.
            'updatedAt' => $application->updated_at?->toIso8601String(),
        ];
    }
}
