<?php

namespace App\Support\Cip;

/**
 * A step refused because documents it hands over are not Ready for
 * submission, carrying which ones.
 *
 * The refusal used to be one sentence with every document strung along it:
 * "Not yet Ready for submission: A (Application review); B (Pending upload);
 * …". On a family of four that is a paragraph in a toast, and it read as an
 * error dump rather than as a list of things to do. The sentence is still
 * the message, for a reader that only has a line to show. The documents
 * travel beside it as rows, so a screen can draw them as what they are: a
 * checklist, by person, each with its status.
 *
 * Still an InvalidArgumentException. Everything that already catches a
 * refusal, the checklist walking a file, the application following its
 * people, goes on catching this one.
 */
class NotReady extends \InvalidArgumentException
{
    /**
     * @param  list<array{id:?string, person:string, personId:?string, label:string, required:bool, status:string, statusLabel:string, statusTone:string}>  $blockers
     */
    public function __construct(
        string $message,
        public readonly array $blockers = [],
        /*
         * Whether the reader who was refused may read the list and carry on.
         * An administrator moving a file past an unfinished checklist is
         * told what is missing and asked to acknowledge it, rather than being
         * stopped; see {@see CipAccess::canAcknowledgeBlockers()}.
         */
        public readonly bool $acknowledgeable = false,
    ) {
        parent::__construct($message);
    }

    /** The same refusal, marked as one this reader may continue past. */
    public function acknowledgeableBy(?\App\Models\User $actor, string $to): self
    {
        if (! CipAccess::canAcknowledgeBlockers($actor, $to)) {
            return $this;
        }

        return new self($this->getMessage(), $this->blockers, true);
    }

    /**
     * The 422 a controller answers a refused step with.
     *
     * Any refusal is the same status and the same `message` as before. One
     * that is about documents also says which, under `blockers`.
     */
    public static function abort(\InvalidArgumentException $e): never
    {
        if ($e instanceof self && ($e->blockers !== [] || $e->acknowledgeable)) {
            abort(response()->json(array_filter([
                'message' => $e->getMessage(),
                'blockers' => $e->blockers,
                'canAcknowledge' => $e->acknowledgeable ?: null,
            ], fn ($value) => $value !== null), 422));
        }

        abort(422, $e->getMessage());
    }
}
