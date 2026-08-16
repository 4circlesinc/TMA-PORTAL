<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipDocumentRequirement;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Requirements;
use App\Support\Cip\Status;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * The requirement templates (§11), and the minimal form behind them.
 *
 * §11 calls the document list admin-configurable, and until this existed the
 * only way to ask an applicant for one more piece of paper was a deploy. This
 * is the server side of that; the full administration console is phase 11.
 *
 * Reading is open to anyone who may reach the module, because the checklist UI
 * needs the labels to draw itself. Changing is an administrator's, and only
 * an administrator's: a template edit reaches every application at once, which
 * is a different order of act from filling in one of them.
 */
class CipRequirementController extends Controller
{
    /** Every template, grouped by applicant type, retired ones included. */
    public function index(Request $request): JsonResponse
    {
        abort_unless(CipAccess::canReach($request->user()), 404);

        $all = CipDocumentRequirement::withTrashed()
            ->orderBy('applicant_type')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json([
            // Every type appears even when it has no templates yet, so the
            // form offers somewhere to add the first one rather than hiding
            // the applicant type that needs it most.
            'types' => collect(ApplicantType::ALL)->map(fn (string $type) => [
                'value' => $type,
                'label' => ApplicantType::label($type),
                'requirements' => $all->where('applicant_type', $type)
                    ->map(fn ($r) => $this->record($r))->values()->all(),
            ])->all(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'applicantType' => ['required', 'string', 'max:32'],
            'label' => ['required', 'string', 'max:191'],
            'required' => ['nullable', 'boolean'],
            'help' => ['nullable', 'string', 'max:2000'],
        ]);

        abort_unless(ApplicantType::isValid($data['applicantType']), 422, 'That is not an applicant type.');

        $key = $this->key($data['label']);

        $clash = CipDocumentRequirement::withTrashed()
            ->where('applicant_type', $data['applicantType'])
            ->where('key', $key)
            ->first();

        // A retired requirement coming back is a restore, not a second row —
        // the slots already filed against it are keyed on this same slug and
        // would otherwise be orphaned beside a duplicate.
        if ($clash) {
            $requirement = Requirements::restore($clash);
            $requirement->forceFill(['label' => $data['label']])->save();
        } else {
            $requirement = CipDocumentRequirement::create([
                'applicant_type' => $data['applicantType'],
                'key' => $key,
                'label' => $data['label'],
                'required' => $data['required'] ?? true,
                'help' => $data['help'] ?? null,
                'sort_order' => $this->nextOrder($data['applicantType']),
            ]);
        }

        $this->reachOpenApplications();

        return response()->json(['requirement' => $this->record($requirement->fresh())], 201);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeManage($request);
        $requirement = $this->find($uuid);

        $data = $request->validate([
            'label' => ['sometimes', 'string', 'max:191'],
            'required' => ['sometimes', 'boolean'],
            'help' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        /*
         * The key is not in that list, and cannot be.
         *
         * Every slot already filed against this requirement is keyed on the
         * slug, so renaming the LABEL is an edit and renaming the KEY orphans
         * every document anybody has uploaded. The wording is the firm's to
         * change; the identity is not.
         */
        $requirement->fill($data)->save();

        return response()->json(['requirement' => $this->record($requirement->fresh())]);
    }

    /** Retire it. Never a hard delete — see Requirements::retire. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeManage($request);
        $requirement = Requirements::retire($this->find($uuid));

        return response()->json(['requirement' => $this->record($requirement->fresh())]);
    }

    public function restore(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeManage($request);
        $requirement = Requirements::restore($this->find($uuid));

        $this->reachOpenApplications();

        return response()->json(['requirement' => $this->record($requirement->fresh())]);
    }

    /** The order the checklist reads in, for one applicant type. */
    public function reorder(Request $request): JsonResponse
    {
        $this->authorizeManage($request);

        $data = $request->validate([
            'applicantType' => ['required', 'string', 'max:32'],
            'order' => ['required', 'array'],
            'order.*' => ['string', 'max:64'],
        ]);

        abort_unless(ApplicantType::isValid($data['applicantType']), 422, 'That is not an applicant type.');

        foreach (array_values($data['order']) as $position => $uuid) {
            CipDocumentRequirement::withTrashed()
                ->where('applicant_type', $data['applicantType'])
                ->where('uuid', $uuid)
                ->update(['sort_order' => $position]);
        }

        return $this->index($request);
    }

    /* ── internals ─────────────────────────────────── */

    private function authorizeManage(Request $request): void
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);
        abort_unless($user && Role::isAdmin($user), 403, 'Only an administrator can change the document requirements.');
    }

    private function find(string $uuid): CipDocumentRequirement
    {
        return CipDocumentRequirement::withTrashed()->where('uuid', $uuid)->firstOrFail();
    }

    /**
     * A stable slug from the wording, unique within the applicant type.
     *
     * Derived rather than typed: the firm is naming a document, not choosing a
     * database key, and asking them for both is asking them to get one of them
     * wrong.
     */
    private function key(string $label): string
    {
        $key = Str::snake(Str::ascii(trim($label)));

        return $key === '' ? 'requirement_'.Str::lower(Str::random(6)) : Str::limit($key, 64, '');
    }

    private function nextOrder(string $applicantType): int
    {
        return (int) CipDocumentRequirement::withTrashed()
            ->where('applicant_type', $applicantType)
            ->max('sort_order') + 1;
    }

    /**
     * A new requirement reaches the applications already in flight.
     *
     * Safe because materialise never removes a slot that holds a file: the
     * worst it can do is ask for something new, which is exactly what the firm
     * just said they wanted. Only the open ones — an application that has been
     * granted or denied is finished, and adding to its checklist would be
     * rewriting history.
     */
    private function reachOpenApplications(): void
    {
        CipApplication::query()
            ->whereNotIn('status', Status::TERMINAL)
            ->with('people')
            ->chunkById(50, function ($applications) {
                foreach ($applications as $application) {
                    Requirements::materialiseApplication($application);
                }
            });
    }

    /** @return array<string, mixed> */
    private function record(CipDocumentRequirement $requirement): array
    {
        return [
            'id' => $requirement->uuid,
            'applicantType' => $requirement->applicant_type,
            'key' => $requirement->key,
            'label' => $requirement->label,
            'required' => (bool) $requirement->required,
            'help' => $requirement->help,
            'sortOrder' => (int) $requirement->sort_order,
            'retired' => $requirement->trashed() || ! $requirement->active,
        ];
    }
}
