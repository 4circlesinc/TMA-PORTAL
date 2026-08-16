<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The Reviewing Officer's verdicts on a checklist, and what the application
 * does about them (§14).
 *
 * Review is a per-document job. The officer reads one slot and either accepts
 * it or sends it back with a reason; {@see DocumentEngine} owns both of those
 * moves, and this class is the caller the brief describes rather than a second
 * machine standing beside it.
 *
 * What is new here is the roll-up. An application's status is not typed in by
 * whoever is working the checklist — it is read OFF the checklist, every time
 * one of these verbs lands. One document sent back means the provider side has
 * work to do, so the file reads Update required and turns up in §9's bucket;
 * every required document accepted means the assessment is finished, so it
 * reads Assessment feedback (§14).
 *
 * {@see settle()} is that inference, and it is deliberately an inference. It
 * drives {@see Engine} only along edges the lifecycle already allows and leaves
 * the application exactly where it is otherwise, so a reviewer clearing a
 * checklist can never push a file somewhere the map forbids — the map is the
 * lifecycle, and a full checklist is not an argument for leaving it.
 */
class Review
{
    /**
     * Accept a document: good enough to go to the Unit.
     *
     * Not an exit — see {@see DocumentStatus} — so an officer who notices
     * something later may still send it back until the package freezes.
     */
    public static function approve(CipDocument $document, User $actor): CipDocument
    {
        return DB::transaction(function () use ($document, $actor) {
            /*
             * Approving what is already approved is not a second verdict.
             * These are inline buttons on a checklist row: a double-click, or
             * a second officer clearing a row a colleague cleared a moment
             * ago, has to be the state it already is rather than an illegal
             * transition. Every other refusal still belongs to the engine.
             */
            if ($document->status !== DocumentStatus::READY_FOR_SUBMISSION) {
                DocumentEngine::apply($document, DocumentStatus::READY_FOR_SUBMISSION, $actor, [
                    'reason' => 'approved',
                ]);
            }

            self::settle($document->loadMissing('application')->application, $actor);

            return $document;
        });
    }

    /**
     * Send a document back, with the reason.
     *
     * The reason is not optional and cannot be made optional. "Update
     * required" on its own is a reviewer making the provider guess, and the
     * guess costs a round trip of the turnaround time §14 is measured in — so
     * the comment and the verdict are one transaction, and neither lands
     * without the other.
     *
     * @throws ValidationException no reason was given
     */
    public static function requestChanges(CipDocument $document, User $actor, string $comment): CipDocument
    {
        $reason = trim($comment);

        if ($reason === '') {
            throw ValidationException::withMessages([
                'comment' => 'Say what needs changing — this is all the provider side will be told.',
            ]);
        }

        return DB::transaction(function () use ($document, $actor, $reason) {
            /*
             * Written first so its uuid can ride in the transition's audit
             * meta: the event says a document was sent back, and the meta says
             * where to read why. The other way round the trail would record a
             * verdict with no way home to its reason.
             */
            $note = DocumentComments::create($document, $actor, $reason);

            // A document already sent back can be sent back again — an officer
            // adding a second reason to one they have already refused. The
            // reason is the point of the verb; the slot is where it needs to
            // be, and there is no edge for standing still.
            if ($document->status !== DocumentStatus::UPDATE_REQUIRED) {
                DocumentEngine::apply($document, DocumentStatus::UPDATE_REQUIRED, $actor, [
                    'reason' => 'changes_requested',
                    'comment' => $note->uuid,
                ]);
            }

            self::settle($document->loadMissing('application')->application, $actor);

            /*
             * Phase 5's fan-out attaches here, and here specifically: this is
             * the first moment both halves of what the provider side needs
             * exist — the document sent back, and the reason why. There is no
             * mailer to call yet. The seam is the point, exactly as {@see
             * Engine} says it is for the application's own transitions.
             */

            return $document;
        });
    }

    /**
     * Put the application where its checklist says it belongs.
     *
     * Called after every document verb, and cheap enough to be: one aggregate
     * over the slots, and a write only when the answer has actually changed.
     *
     * A null actor is the system, which is what an upload path passes. A
     * provider contact re-uploading a scan has made no judgement about the
     * application and holds no capability to move it — the checklist moved,
     * and the file followed.
     */
    public static function settle(CipApplication $application, ?User $actor = null): CipApplication
    {
        $target = self::target($application);

        // Legality is asked of the engine, never assumed. An application in
        // its first read has no edge to Update required, so a document sent
        // back during that read moves the slot and leaves the file alone
        // rather than forcing a transition the lifecycle does not have.
        if ($target === null || ! Engine::canTransition($application, $target)) {
            return $application;
        }

        return Engine::apply($application, $target, $actor, ['reason' => 'checklist']);
    }

    /**
     * The checklist as numbers, for the dashboards §9 and phase 4c draw.
     *
     * Every status is present with a zero rather than only the ones in use: a
     * bar or a legend built from this must not lose a segment on the day
     * nothing happens to sit in it, and a caller who has to remember which
     * keys might be missing will forget.
     *
     * @return array{total: int, required: int, outstanding: int, complete: bool, counts: array<string, int>}
     */
    public static function progress(CipApplication $application): array
    {
        $tally = self::tally($application);

        $counts = array_map(fn (array $row) => $row['total'], $tally);
        $required = array_sum(array_column($tally, 'required'));
        $ready = $tally[DocumentStatus::READY_FOR_SUBMISSION]['required'];

        return [
            'total' => array_sum($counts),
            'required' => $required,
            // What still stands between this application and a submission
            // package: required slots nobody has accepted yet, whether they
            // are empty, unread or refused.
            'outstanding' => $required - $ready,
            'complete' => $required > 0 && $ready === $required,
            'counts' => $counts,
        ];
    }

    /**
     * Where the checklist says the application belongs, or null for "leave it
     * where it is".
     */
    private static function target(CipApplication $application): ?string
    {
        $tally = self::tally($application);

        // One document sent back is enough. Whatever else is settled, the
        // provider side has work to do, and saying so is what puts the file in
        // front of them instead of in front of the officer.
        if ($tally[DocumentStatus::UPDATE_REQUIRED]['total'] > 0) {
            return Status::UPDATE_REQUIRED;
        }

        $required = array_sum(array_column($tally, 'required'));
        $ready = $tally[DocumentStatus::READY_FOR_SUBMISSION]['required'];

        /*
         * §14: every document assessed.
         *
         * "Every" over an empty checklist is vacuously true, which is why the
         * count has to be positive as well as met. An application nobody has
         * asked anything of has not been assessed, and moving it on the
         * strength of an empty set would take it out of the officer's hands
         * before they had read a page of it.
         *
         * Optional documents are counted in neither number. A translation the
         * firm would like but does not demand cannot hold an assessment open,
         * or "optional" would mean nothing at all.
         */
        return $required > 0 && $ready === $required ? Status::ASSESSMENT_FEEDBACK : null;
    }

    /**
     * The whole application's checklist counted in one query: how many slots
     * sit at each status, and how many of those were required.
     *
     * Aggregated in the database rather than loaded. This runs on every
     * document verb, and a family of six against a dozen requirements is
     * seventy rows fetched to answer a question about four numbers.
     *
     * @return array<string, array{total: int, required: int}>
     */
    private static function tally(CipApplication $application): array
    {
        $tally = [];

        foreach (DocumentStatus::ALL as $status) {
            $tally[$status] = ['total' => 0, 'required' => 0];
        }

        $rows = CipDocument::query()
            ->where('application_id', $application->getKey())
            ->selectRaw('status, required, COUNT(*) as total')
            ->groupBy('status', 'required')
            ->get();

        foreach ($rows as $row) {
            $total = (int) $row->total;

            // A status outside the vocabulary is not silently dropped: losing
            // a required slot from the count would read as "all assessed" and
            // move the application on work nobody has done.
            $tally[$row->status] ??= ['total' => 0, 'required' => 0];

            $tally[$row->status]['total'] += $total;

            if ($row->required) {
                $tally[$row->status]['required'] += $total;
            }
        }

        return $tally;
    }
}
