<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplicationDraft;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Phase;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The intake wizard's autosave: one unfinished application per reader, per phase.
 *
 * WHY THE SERVER AND NOT THE TAB
 *
 * A draft that lived in localStorage would be a resume that only works on the
 * machine it was typed on, and in the desktop app the local store is the only
 * copy of a citizenship client's details on somebody's disk. Kept here it
 * follows the reader to whatever they next sign in on, and it is deleted the
 * moment the application is filed.
 *
 * WHAT IS NOT SAVED
 *
 * Files. See the migration: a scan uploaded into something nobody has filed
 * would be an unreviewed document in a client's folders. The wizard tells the
 * reader which scans it could not keep, in those words, rather than resuming
 * silently and letting them believe a checklist is answered.
 *
 * NO VALIDATION BEYOND SHAPE
 *
 * A draft is by definition incomplete — that is the whole point — so this
 * refuses only what it cannot store. What an application must contain is
 * Intake::rules's business, and it is asked at filing, where a reader can
 * still do something about the answer.
 */
class CipApplicationDraftController extends Controller
{
    /**
     * How much of a draft is kept.
     *
     * A ceiling rather than a guess: six dependents at eight fields, plus a
     * sponsor and the investment answers, is a few hundred short strings. A
     * body larger than this is not a long application, it is something else,
     * and the row it would write is one nobody can use.
     */
    private const MAX_ANSWERS = 400;

    private const MAX_VALUE_LENGTH = 500;

    /** The draft to reopen, or nothing when there is none to reopen. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $draft = CipApplicationDraft::query()
            ->where('user_id', $user->id)
            ->where('phase', $this->phase($request))
            ->first();

        return response()->json(['draft' => $draft ? $this->record($draft) : null]);
    }

    /**
     * Keep what has been typed so far.
     *
     * An upsert on (user, phase): the wizard saves every few seconds and the
     * reader has one unfinished application per form, so a second row would
     * be a second resume offering older work.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        $phase = $this->phase($request);
        $answers = $this->answers($request);

        /*
         * Nothing typed is nothing to keep.
         *
         * The wizard fills the provider in for itself when a reader can only
         * file under one firm, so an untouched form is not empty — and a
         * draft holding only that would offer to resume a form nobody has
         * begun. Emptying a form is also how a reader abandons one, so this
         * clears rather than saves.
         */
        if ($answers === []) {
            CipApplicationDraft::query()
                ->where('user_id', $user->id)
                ->where('phase', $phase)
                ->delete();

            return response()->json(['draft' => null]);
        }

        $attributes = [
            'answers' => $answers,
            'dependents' => min(max((int) $request->input('dependents', 0), 0), 20),
        ];

        try {
            $draft = CipApplicationDraft::query()->updateOrCreate(
                ['user_id' => $user->id, 'phase' => $phase],
                $attributes,
            );
        } catch (UniqueConstraintViolationException $e) {
            /*
             * Two saves of the same draft racing. The index picked a winner;
             * the loser writes onto the row that landed rather than failing,
             * because both carry the same reader's newest answers and an
             * autosave that reports an error would be alarming for nothing.
             */
            $draft = CipApplicationDraft::query()
                ->where('user_id', $user->id)
                ->where('phase', $phase)
                ->first();
            if ($draft === null) {
                throw $e;
            }
            $draft->fill($attributes)->save();
        }

        return response()->json(['draft' => $this->record($draft)]);
    }

    /** The reader discarded it, or filed the application it became. */
    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canCreate($user), 404);

        CipApplicationDraft::query()
            ->where('user_id', $user->id)
            ->where('phase', $this->phase($request))
            ->delete();

        return response()->json(['draft' => null]);
    }

    private function phase(Request $request): string
    {
        $phase = (string) ($request->input('phase') ?? $request->query('phase', ''));

        return $phase === Phase::POST_APPROVAL ? Phase::POST_APPROVAL : Phase::PRE_APPROVAL;
    }

    /**
     * The answers, reduced to what a draft may hold.
     *
     * Strings keyed by the wizard's own field paths, nothing else. The body
     * arrives from a browser and is written back into a form, so a value that
     * is not a scalar, a key that is not a field path, and anything past the
     * ceiling is dropped here rather than stored and puzzled over later.
     *
     * @return array<string, string>
     */
    private function answers(Request $request): array
    {
        $answers = $request->input('answers');
        if (! is_array($answers)) {
            return [];
        }

        $out = [];
        foreach ($answers as $path => $value) {
            if (count($out) >= self::MAX_ANSWERS) {
                break;
            }
            if (! is_string($path) || ! preg_match('/^[A-Za-z0-9_.]{1,80}$/', $path)) {
                continue;
            }
            if (is_bool($value) || is_int($value) || is_float($value)) {
                $value = (string) $value;
            }
            if (! is_string($value)) {
                continue;
            }
            $value = mb_substr($value, 0, self::MAX_VALUE_LENGTH);
            if (trim($value) === '') {
                continue;
            }
            $out[$path] = $value;
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function record(CipApplicationDraft $draft): array
    {
        return [
            'id' => $draft->uuid,
            'phase' => $draft->phase,
            'answers' => $draft->answers ?? [],
            'dependents' => (int) $draft->dependents,
            'savedAt' => $draft->updated_at?->toIso8601String(),
        ];
    }
}
