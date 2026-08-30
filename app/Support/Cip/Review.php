<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\User;
use App\Support\Files\Comments;
use Illuminate\Database\Eloquent\Builder;
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
 * whoever is working the checklist, it is read OFF the checklist, every time
 * one of these verbs lands. One document sent back is Updates Required, the
 * provider side already has work. Ready to submit is only for a file whose
 * documents are all judged: a slot still in Application review or Update
 * required cannot sit under that label, and a picker cannot put it there.
 *
 * {@see settle()} is that inference, and it is deliberately an inference. It
 * drives {@see Engine} only along edges the lifecycle already allows and leaves
 * the application exactly where it is otherwise, so a reviewer clearing a
 * checklist can never push a file somewhere the map forbids, the map is the
 * lifecycle, and a full checklist is not an argument for leaving it.
 */
class Review
{
    public static function flushTally(): void
    {
        self::forgetTally();
    }

    /** Drop a cached checklist count so the next read sees the slots as they are now. */
    public static function forgetTally(?CipApplication $application = null): void
    {
        if (! app()->bound('request')) {
            return;
        }

        if ($application === null) {
            request()->attributes->remove('cip.tally');

            return;
        }

        $store = request()->attributes->get('cip.tally', []);
        unset($store[(int) $application->getKey()]);
        request()->attributes->set('cip.tally', $store);
    }

    /**
     * Count every application's checklist in one grouped query.
     *
     * {@see Engine::availableOverrides()} asks this for Ready to Submit when
     * checklists are already loaded. Unprimed that is one COUNT per application.
     *
     * @param  iterable<int, CipApplication>  $applications
     */
    public static function primeTally(iterable $applications): void
    {
        $store = request()->attributes->get('cip.tally', []);
        $missing = collect($applications)
            ->filter()
            ->reject(fn (CipApplication $application) => array_key_exists(
                (int) $application->getKey(),
                $store,
            ));

        if ($missing->isEmpty()) {
            return;
        }

        $preIds = $missing
            ->filter(fn (CipApplication $application) => ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL)
            ->map(fn (CipApplication $application) => $application->getKey())
            ->all();
        $postIds = $missing
            ->filter(fn (CipApplication $application) => ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL)
            ->map(fn (CipApplication $application) => $application->getKey())
            ->all();

        $grouped = collect();

        if ($preIds !== []) {
            $grouped = $grouped->merge(
                CipDocument::query()
                    ->whereIn('application_id', $preIds)
                    ->selectRaw('application_id, status, required, COUNT(*) as total')
                    ->groupBy('application_id', 'status', 'required')
                    ->get()
            );
        }

        if ($postIds !== []) {
            $grouped = $grouped->merge(
                self::constrainToCurrentChecklist(
                    CipDocument::query()->whereIn('application_id', $postIds),
                    Phase::POST_APPROVAL,
                )
                    ->selectRaw('application_id, status, required, COUNT(*) as total')
                    ->groupBy('application_id', 'status', 'required')
                    ->get()
            );
        }

        $grouped = $grouped->groupBy(fn ($row) => (int) $row->application_id);

        foreach ($missing as $application) {
            $store[(int) $application->getKey()] = self::shapeTally(
                $grouped->get((int) $application->getKey(), collect()),
            );
        }

        request()->attributes->set('cip.tally', $store);
    }

    /**
     * Accept a document: mark it Ready for submission.
     *
     * That is the file verdict, not application Granted. Staff may reach it
     * from Application review or Update required; an empty slot cannot be
     * judged. Not an exit, see {@see DocumentStatus}, so an officer who
     * notices something later may still send it back.
     */
    public static function approve(CipDocument $document, User $actor): CipDocument
    {
        Confirmation::guardDocument($document);

        return DB::transaction(function () use ($document, $actor) {
            /*
             * Approving what is already approved is not a second verdict.
             * These are inline buttons on a checklist row: a double-click, or
             * a second officer clearing a row a colleague cleared a moment
             * ago, has to be the state it already is rather than an illegal
             * transition. Every other refusal still belongs to the engine.
             */
            if ($document->status !== DocumentStatus::READY_FOR_SUBMISSION) {
                DocumentEngine::set($document, DocumentStatus::READY_FOR_SUBMISSION, $actor, [
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
     * guess costs a round trip of the turnaround time §14 is measured in, so
     * the comment and the verdict are one transaction, and neither lands
     * without the other.
     *
     * @throws ValidationException no reason was given
     */
    public static function requestChanges(CipDocument $document, User $actor, string $comment): CipDocument
    {
        Confirmation::guardDocument($document);

        $reason = trim($comment);

        if ($reason === '') {
            throw ValidationException::withMessages([
                'comment' => 'Say what needs changing, this is all the provider side will be told.',
            ]);
        }

        $document = DB::transaction(function () use ($document, $actor, $reason) {
            $before = $document->loadMissing('application')->application->status;

            /*
             * Written first so its uuid can ride in the transition's audit
             * meta: the event says a document was sent back, and the meta says
             * where to read why. The other way round the trail would record a
             * verdict with no way home to its reason.
             */
            $note = DocumentComments::create($document, $actor, $reason);

            // A document already sent back can be sent back again, an officer
            // adding a second reason to one they have already refused. The
            // reason is the point of the verb; the slot is where it needs to
            // be, and there is no edge for standing still.
            if ($document->status !== DocumentStatus::UPDATE_REQUIRED) {
                DocumentEngine::apply($document, DocumentStatus::UPDATE_REQUIRED, $actor, [
                    'reason' => 'changes_requested',
                    'comment' => $note->uuid,
                    'note' => $reason,
                ]);
            }

            self::settle($document->loadMissing('application')->application, $actor);
            self::announceSentBack($document, $actor, $reason, $before);

            return $document;
        });

        /*
         * Workflows → Feedback and Comments lists file threads, not the slot
         * conversation. The File Library chip already mirrors the reason onto
         * the file; the checklist path has to do the same or the provider
         * side would only see it under Updates required.
         */
        $file = $document->file;
        if ($file) {
            try {
                Comments::create($file, $actor, $reason);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        return $document;
    }

    /**
     * Tell everyone on the application that this document was sent back,
     * unless the application's own Updates Required notice just did.
     *
     * The status notice fires from {@see settle()} when the application
     * ENTERS Updates Required, and names every refused slot, this one
     * included. A refusal that finds the file already there, or somewhere
     * the checklist cannot move it from, changes no status and used to tell
     * nobody. `$before` is the application's status before the verdict.
     */
    public static function announceSentBack(CipDocument $document, ?User $actor, string $reason, string $before): void
    {
        $after = (string) ($document->application()->value('status') ?? $before);

        if ($before !== Status::UPDATE_REQUIRED && $after === Status::UPDATE_REQUIRED) {
            return;
        }

        Notices::documentSentBack($document, $actor, $reason);
    }

    /**
     * Put the application where its checklist says it belongs.
     *
     * Called after every document verb, and cheap enough to be: one aggregate
     * over the slots, and a write only when the answer has actually changed.
     *
     * A null actor is the system, which is what an upload path passes. A
     * provider contact re-uploading a scan has made no judgement about the
     * application and holds no capability to move it, the checklist moved,
     * and the file followed.
     */
    public static function settle(CipApplication $application, ?User $actor = null): CipApplication
    {
        self::forgetTally($application);

        /*
         * A plan rather than a single hop, because §14 and §15 are two
         * sentences of one moment. After every required document has been
         * assessed the file always passes through Assessment feedback; then
         * either Updates required (and the firm is told) or Ready to submit
         * (and the firm is told to confirm). Walking both edges in one settle
         * is what "moves toward submission" means, leaving the file parked
         * at Assessment feedback would make the all-clear a status somebody
         * still had to type.
         *
         * Legality is asked of the engine, never assumed. An application
         * whose next hop is not on the map is written as an inference when
         * the checklist has left Ready to submit, rather than staying on a
         * label the files no longer support.
         */
        foreach (self::plan($application) as $target) {
            /*
             * File status is a working label. Ready to Submit is not. If a
             * hop still names it while a slot sits in Application review or
             * Update required, skip it — do not throw. Throwing here used to
             * 422 the document PATCH after the slot had already been written,
             * which rolled the chip back on screen.
             */
            if (in_array($target, [Status::READY_TO_SUBMIT, Status::APPLY_FOR_COR], true)
                && ! self::documentsAllowReadyToSubmit($application)) {
                continue;
            }

            $meta = ['reason' => 'checklist'];

            if (Engine::canTransition($application, $target)) {
                // The checklist moved. Whoever marked the document may not be
                // allowed to type application status; the file still follows.
                $who = $actor;
                if ($who !== null && ! Engine::allows($who, $application, $target)) {
                    $who = null;
                }

                $application = Engine::apply($application, $target, $who, $meta);

                continue;
            }

            // Neither Ready to submit nor Updates required has a mapped
            // reverse into Review Applications. The checklist still has to
            // leave those labels when a file goes back into review, so the
            // system writes it as an inference.
            $application = Engine::set($application, $target, null, $meta);
        }

        return $application;
    }

    /**
     * Whether the checklist may wear Ready to Submit.
     *
     * A file still in Application review has not been judged, and a file in
     * Update required is work the provider side still has. Either one is
     * enough. Optional slots count: they are files on the checklist, not
     * decoration beside it. Empty optional slots (Pending upload) do not.
     */
    public static function documentsAllowReadyToSubmit(CipApplication $application): bool
    {
        $tally = self::tally($application);

        return $tally[DocumentStatus::UPDATE_REQUIRED]['total'] === 0
            && $tally[DocumentStatus::APPLICATION_REVIEW]['total'] === 0;
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
     * The statuses the checklist says to walk, in order, or empty for "leave
     * it where it is".
     *
     * @return list<string>
     */
    private static function plan(CipApplication $application): array
    {
        $tally = self::tally($application);
        $required = array_sum(array_column($tally, 'required'));

        /*
         * Any file sent back is enough. The application is Updates Required
         * the moment one document is, whether or not the rest of the
         * checklist has been read: the provider side already has work, and
         * waiting for the officer to finish the pile would hide that.
         *
         * Optional documents count. "Any file" is the rule, not only the
         * required ones.
         */
        $from = $application->status;
        $needsUpdates = $tally[DocumentStatus::UPDATE_REQUIRED]['total'] > 0;
        $inReview = $tally[DocumentStatus::APPLICATION_REVIEW]['total'] > 0;

        if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
            return self::planPostApproval($from, $needsUpdates, $inReview, $required, $tally);
        }

        if ($needsUpdates) {
            return match ($from) {
                Status::NEW => [
                    Status::REVIEW_APPLICATION,
                    Status::ASSESSMENT_FEEDBACK,
                    Status::UPDATE_REQUIRED,
                ],
                Status::REVIEW_APPLICATION => [Status::ASSESSMENT_FEEDBACK, Status::UPDATE_REQUIRED],
                Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT => [Status::UPDATE_REQUIRED],
                default => [],
            };
        }

        /*
         * A file put back into Application review cannot keep the application
         * at Ready to submit. The officer is reading again; that is Review
         * Applications, not a package waiting on Confirm submission.
         */
        if ($from === Status::READY_TO_SUBMIT && $inReview) {
            return [Status::REVIEW_APPLICATION];
        }

        /*
         * §14: after review of ALL documents.
         *
         * "Every" over an empty checklist is vacuously true, which is why the
         * count has to be positive as well as met. An application nobody has
         * asked anything of has not been assessed, and moving it on the
         * strength of an empty set would take it out of the officer's hands
         * before they had read a page of it.
         *
         * A required slot still in Pending upload has not been assessed, so
         * Ready to submit waits. A filed slot still in Application review —
         * required or optional — is the same: it is a file nobody has judged.
         * An optional slot that was never uploaded does not hold the
         * assessment open; that is still what "optional" means.
         */
        $unassessed = $tally[DocumentStatus::PENDING_UPLOAD]['required']
            + $tally[DocumentStatus::APPLICATION_REVIEW]['required'];

        $allReady = $required > 0
            && $unassessed === 0
            && ! $inReview
            && $tally[DocumentStatus::READY_FOR_SUBMISSION]['required'] === $required;

        /*
         * The last file sent back has been resolved, re-uploaded or moved by
         * hand, and nothing else is refused. Updates Required was the
         * checklist's word for "the provider side has work"; with none left
         * the officer is reading again, so the application goes back to
         * Review Applications on its own rather than waiting for somebody to
         * type it. Only a checklist already accepted in full skips that and
         * walks on to Ready to submit below.
         */
        if ($from === Status::UPDATE_REQUIRED && ! $allReady) {
            return [Status::REVIEW_APPLICATION];
        }

        if (! $allReady) {
            return [];
        }

        return match ($from) {
            Status::REVIEW_APPLICATION, Status::UPDATE_REQUIRED => [
                Status::ASSESSMENT_FEEDBACK,
                Status::READY_TO_SUBMIT,
            ],
            Status::ASSESSMENT_FEEDBACK => [Status::READY_TO_SUBMIT],
            default => [],
        };
    }

    /**
     * Post-approval has no Assessment Feedback hop. A refused COR document is
     * Updates Required; a complete COR checklist is Apply for COR.
     *
     * @param  array<string, array{total: int, required: int}>  $tally
     * @return list<string>
     */
    private static function planPostApproval(
        string $from,
        bool $needsUpdates,
        bool $inReview,
        int $required,
        array $tally,
    ): array {
        if ($needsUpdates) {
            return match ($from) {
                Status::POST_APPROVAL, Status::APPLY_FOR_COR => [Status::UPDATE_REQUIRED],
                default => [],
            };
        }

        if ($from === Status::APPLY_FOR_COR && $inReview) {
            return [Status::POST_APPROVAL];
        }

        $unassessed = $tally[DocumentStatus::PENDING_UPLOAD]['required']
            + $tally[DocumentStatus::APPLICATION_REVIEW]['required'];

        $allReady = $required > 0
            && $unassessed === 0
            && ! $inReview
            && $tally[DocumentStatus::READY_FOR_SUBMISSION]['required'] === $required;

        if ($from === Status::UPDATE_REQUIRED && ! $allReady) {
            return [Status::POST_APPROVAL];
        }

        if (! $allReady) {
            return [];
        }

        return match ($from) {
            Status::POST_APPROVAL, Status::UPDATE_REQUIRED => [Status::APPLY_FOR_COR],
            default => [],
        };
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
        $id = (int) $application->getKey();
        $store = request()->attributes->get('cip.tally', []);

        if (array_key_exists($id, $store)) {
            return $store[$id];
        }

        $rows = self::constrainToCurrentChecklist(
            CipDocument::query()->where('application_id', $application->getKey()),
            $application->phase ?? Phase::PRE_APPROVAL,
            $application,
        )
            ->selectRaw('status, required, COUNT(*) as total')
            ->groupBy('status', 'required')
            ->get();

        $store[$id] = self::shapeTally($rows);
        request()->attributes->set('cip.tally', $store);

        return $store[$id];
    }

    /**
     * @param  \Illuminate\Support\Collection<int, mixed>  $rows
     * @return array<string, array{total: int, required: int}>
     */
    private static function shapeTally($rows): array
    {
        $tally = [];

        foreach (DocumentStatus::ALL as $status) {
            $tally[$status] = ['total' => 0, 'required' => 0];
        }

        foreach ($rows as $row) {
            $total = (int) $row->total;
            $tally[$row->status] ??= ['total' => 0, 'required' => 0];
            $tally[$row->status]['total'] += $total;

            if ($row->required) {
                $tally[$row->status]['required'] += $total;
            }
        }

        return $tally;
    }

    /**
     * Restrict a document query to the checklist the current phase is judging.
     *
     * Post-approval must not count leftover pre-approval slots or Real Estate
     * paper on a donation file; either would poison Updates Required and
     * Apply for COR.
     *
     * @param  Builder<\App\Models\CipDocument>  $query
     * @return Builder<\App\Models\CipDocument>
     */
    public static function constrainToCurrentChecklist(
        Builder $query,
        string $phase,
        ?CipApplication $application = null,
    ): Builder {
        if ($phase !== Phase::POST_APPROVAL) {
            return $query;
        }

        $realEstate = $application === null
            || $application->investment_type === InvestmentType::REAL_ESTATE;

        return $query->where(function ($outer) use ($realEstate) {
            $outer->whereHas('requirement', function ($requirement) use ($realEstate) {
                $requirement->where(function ($phase) {
                    $phase->where('at_post_approval', true)
                        ->orWhere(function ($carried) {
                            $carried->where('at_pre_approval', true)->where('carry_forward', true);
                        });
                });

                if (! $realEstate) {
                    $requirement->where(function ($flag) {
                        $flag->where('real_estate_only', false)->orWhereNull('real_estate_only');
                    });
                }
            })->orWhere(function ($loose) {
                $loose->whereNull('requirement_id')->whereIn('type', CorRequirements::keys());
            });
        });
    }
}
