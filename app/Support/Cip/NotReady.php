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
    public function __construct(string $message, public readonly array $blockers = [])
    {
        parent::__construct($message);
    }

    /**
     * The 422 a controller answers a refused step with.
     *
     * Any refusal is the same status and the same `message` as before. One
     * that is about documents also says which, under `blockers`.
     */
    public static function abort(\InvalidArgumentException $e): never
    {
        if ($e instanceof self && $e->blockers !== []) {
            abort(response()->json([
                'message' => $e->getMessage(),
                'blockers' => $e->blockers,
            ], 422));
        }

        abort(422, $e->getMessage());
    }
}
