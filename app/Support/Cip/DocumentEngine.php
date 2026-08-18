<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Realtime\Live;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The one path a document slot's status travels — the same machine {@see
 * Engine} runs for an application, at the scale of a single requirement: a
 * FROM→TO map, a permission per destination, and one transaction that moves
 * the row and writes the append-only cip_events line together. Nothing else
 * writes cip_documents.status.
 *
 * The cycle is deliberately small. A slot is uploaded into review, comes back
 * for an update, and goes round again as many times as the reviewer needs;
 * approving it is not an exit, because §12 lets a document be re-opened until
 * the submission package freezes.
 */
class DocumentEngine
{
    /**
     * The audit action for a slot moving.
     *
     * A document's statuses are their own vocabulary, so they cannot go in
     * cip_events' from_status / to_status columns — those speak {@see Status},
     * and a reviewer reading the file's history must never mistake a birth
     * certificate being approved for the application being approved. The pair
     * rides in the event meta instead, under an action of its own.
     */
    public const ACTION_STATUS_CHANGED = 'document_status_changed';

    /** from => the statuses it may move to. */
    private const TRANSITIONS = [
        DocumentStatus::PENDING_UPLOAD => [DocumentStatus::APPLICATION_REVIEW],
        DocumentStatus::APPLICATION_REVIEW => [DocumentStatus::UPDATE_REQUIRED, DocumentStatus::READY_FOR_SUBMISSION],
        DocumentStatus::UPDATE_REQUIRED => [DocumentStatus::APPLICATION_REVIEW],
        DocumentStatus::READY_FOR_SUBMISSION => [DocumentStatus::UPDATE_REQUIRED],
    ];

    /**
     * Entering this status needs this capability (through CipAccess, so the
     * officer account types count). Judging a document is the Reviewing
     * Officer's work, and both verdicts are the same job.
     *
     * APPLICATION_REVIEW is absent on purpose rather than missing: nobody
     * "sets" it, an upload does, so it is answered by {@see self::allows()}
     * from who may upload against the application instead.
     */
    private const TRANSITION_CAPABILITIES = [
        DocumentStatus::UPDATE_REQUIRED => 'cip.review',
        DocumentStatus::READY_FOR_SUBMISSION => 'cip.review',
    ];

    /**
     * The statuses this slot may move to from where it is.
     *
     * @return list<string>
     */
    public static function next(CipDocument $document): array
    {
        return self::TRANSITIONS[$document->status ?? DocumentStatus::PENDING_UPLOAD] ?? [];
    }

    /** Is this edge in the cycle at all, whoever is asking? */
    public static function canTransition(CipDocument $document, string $to): bool
    {
        return DocumentStatus::isValid($to)
            && in_array($to, self::next($document), true);
    }

    /**
     * May this actor drive the slot to this status? A null actor is the
     * system (a scheduled job) and may drive anything the map allows.
     */
    public static function allows(?User $actor, CipDocument $document, string $to): bool
    {
        if ($actor === null) {
            return true;
        }

        if (! CipAccess::enabled()) {
            return false;
        }

        // The upload is the transition. Whoever may put a file in the slot may
        // put it into review, and the people who do most of that uploading are
        // external accounts that hold no matrix capability — so their reach of
        // the application is the whole grant, exactly as it is for the file
        // itself. An employee with no officer role sees no applications and so
        // reaches nothing here either.
        if ($to === DocumentStatus::APPLICATION_REVIEW) {
            /*
             * The creator counts, and has to.
             *
             * ApplicationScope answers for an application that EXISTS to be
             * looked at — an external account reaches one through their firm's
             * provider or through their own client record. Neither is true
             * while the application is still being filed: the client row is
             * written later in the same transaction, so a private client
             * uploading their own passport was refused a slot on the
             * application they were in the middle of creating.
             *
             * Engine makes the same exception for submission, for the same
             * reason and in the same words: the provider side submits its own
             * draft. Whoever created it may put files in it.
             */
            if ($document->application?->created_by === $actor->id) {
                return true;
            }

            return ApplicationScope::query($actor)->whereKey($document->application_id)->exists();
        }

        $capability = self::TRANSITION_CAPABILITIES[$to] ?? null;

        return $capability !== null && CipAccess::can($actor, $capability);
    }

    /**
     * Apply one transition: validate the edge and the actor, update the row,
     * write the event — atomically. Throws rather than silently refusing, so
     * a caller cannot mistake "nothing happened" for success.
     */
    public static function apply(CipDocument $document, string $to, ?User $actor, array $meta = []): CipDocument
    {
        Confirmation::guard($document->loadMissing('application')->application);

        if (! self::canTransition($document, $to)) {
            throw new \InvalidArgumentException(sprintf(
                'A CIP document cannot move from %s to %s.',
                DocumentStatus::label($document->status),
                DocumentStatus::label($to),
            ));
        }

        if (! self::allows($actor, $document, $to)) {
            throw new AuthorizationException('You cannot move this document to '.DocumentStatus::label($to).'.');
        }

        return DB::transaction(function () use ($document, $to, $actor, $meta) {
            $from = $document->status;
            $document->forceFill(['status' => $to, 'status_changed_at' => now()])->save();

            // The File Library and the Documents tab read files.review_status.
            // A slot that has a file must show the same chip there as it does
            // on the checklist, or a reviewer walking between the two would
            // see two answers for one document.
            if ($document->file_id) {
                $document->loadMissing('file');
                $document->file?->forceFill(['review_status' => $to])->save();
            }

            $application = $document->loadMissing('application')->application;

            // The caller's meta cannot overwrite what the audit is for.
            Engine::record($application, self::ACTION_STATUS_CHANGED, $actor, array_merge($meta, [
                'document' => $document->uuid,
                'fromStatus' => $from,
                'toStatus' => $to,
            ]));

            // Mirror into the portal-wide trail too — that copy is pruned per
            // retention preference; cip_events above is the durable one.
            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.document_status_changed',
                'module' => 'cip',
                'description' => $document->label.' on '.$application->displayNumber()
                    .' moved to '.DocumentStatus::label($to),
                'subject' => $document,
                'old' => ['status' => $from],
                'new' => ['status' => $to],
            ]);

            Live::staff(Live::CIP);

            return $document;
        });
    }
}
