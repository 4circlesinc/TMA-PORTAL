<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipDocumentRequirement;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Phase;
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
            'folder' => ['nullable', 'string', 'max:64'],
            'atPreApproval' => ['nullable', 'boolean'],
            'atPostApproval' => ['nullable', 'boolean'],
            'carryForward' => ['nullable', 'boolean'],
            'realEstateOnly' => ['nullable', 'boolean'],
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

            /*
             * The folder only moves if the request actually spoke about it.
             * The everyday add flow sends a name and nothing else, and a
             * retire-then-re-add through it must not quietly wipe the drawer
             * an administrator had set, restored means back as it was.
             */
            $changes = ['label' => $data['label']];

            if (array_key_exists('folder', $data)) {
                $changes['folder'] = $this->folder($data);
            }

            foreach (['atPreApproval' => 'at_pre_approval', 'atPostApproval' => 'at_post_approval', 'carryForward' => 'carry_forward', 'realEstateOnly' => 'real_estate_only'] as $from => $to) {
                if (array_key_exists($from, $data)) {
                    $changes[$to] = $data[$from];
                }
            }

            $requirement->forceFill($changes)->save();
        } else {
            $requirement = CipDocumentRequirement::create([
                'applicant_type' => $data['applicantType'],
                'key' => $key,
                'label' => $data['label'],
                'required' => $data['required'] ?? true,
                'help' => $data['help'] ?? null,
                'folder' => $this->folder($data),
                'at_pre_approval' => $data['atPreApproval'] ?? true,
                'at_post_approval' => $data['atPostApproval'] ?? false,
                'carry_forward' => $data['carryForward'] ?? false,
                'real_estate_only' => $data['realEstateOnly'] ?? false,
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
            'folder' => ['sometimes', 'nullable', 'string', 'max:64'],
            'atPreApproval' => ['sometimes', 'boolean'],
            'atPostApproval' => ['sometimes', 'boolean'],
            'carryForward' => ['sometimes', 'boolean'],
            'realEstateOnly' => ['sometimes', 'boolean'],
        ]);

        /*
         * Renaming the drawer moves nothing already filed. Like the label,
         * the folder reaches forward only: documents filed under the old name
         * keep the place they were put, and re-homing them here would mean an
         * admin edit silently rearranging files reviewers have links to.
         */
        if (array_key_exists('folder', $data)) {
            $data['folder'] = $this->folder($data);
        }

        $data = $this->mapPhaseFields($data);

        /*
         * The key is not in that list, and cannot be.
         *
         * Every slot already filed against this requirement is keyed on the
         * slug, so renaming the LABEL is an edit and renaming the KEY orphans
         * every document anybody has uploaded. The wording is the firm's to
         * change; the identity is not.
         */
        $requirement->fill($data)->save();

        /*
         * Open applications hear about it, the same way they hear about a new
         * or restored requirement. Materialise already holds the judgement
         * call: a slot still waiting adopts the new wording and the new
         * mandatory flag, an answered one keeps the words it was answered
         * under.
         */
        $this->reachOpenApplications();

        return response()->json(['requirement' => $this->record($requirement->fresh())]);
    }

    /** Retire it. Never a hard delete, see Requirements::retire. */
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
     * The subfolder the form named, or null.
     *
     * Trimmed, and an empty answer stored as null rather than '': the column
     * means "file these uploads in a drawer of this name inside the person's
     * folder", and a blank name is not a drawer, it is the person's folder
     * itself, which is what null already says.
     *
     * @param  array<string, mixed>  $data
     */
    private function folder(array $data): ?string
    {
        $folder = trim(str_replace(['/', '\\'], '', (string) ($data['folder'] ?? '')));

        return $folder === '' ? null : $folder;
    }

    /**
     * A new requirement reaches the applications already in flight.
     *
     * Safe because materialise never removes a slot that holds a file: the
     * worst it can do is ask for something new, which is exactly what the firm
     * just said they wanted. Only the open ones, an application that has been
     * granted or denied is finished, and adding to its checklist would be
     * rewriting history.
     */
    private function reachOpenApplications(): void
    {
        CipApplication::query()
            ->whereNull('locked_at')
            ->where(function ($query) {
                $query->whereNotIn('status', Status::TERMINAL)
                    ->orWhere('phase', Phase::POST_APPROVAL);
            })
            ->with('people')
            ->chunkById(50, function ($applications) {
                foreach ($applications as $application) {
                    Requirements::materialiseApplication($application);
                }
            });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function mapPhaseFields(array $data): array
    {
        if (array_key_exists('atPreApproval', $data)) {
            $data['at_pre_approval'] = $data['atPreApproval'];
            unset($data['atPreApproval']);
        }

        if (array_key_exists('atPostApproval', $data)) {
            $data['at_post_approval'] = $data['atPostApproval'];
            unset($data['atPostApproval']);
        }

        if (array_key_exists('carryForward', $data)) {
            $data['carry_forward'] = $data['carryForward'];
            unset($data['carryForward']);
        }

        if (array_key_exists('realEstateOnly', $data)) {
            $data['real_estate_only'] = $data['realEstateOnly'];
            unset($data['realEstateOnly']);
        }

        return $data;
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
            'folder' => $requirement->folder,
            'atPreApproval' => (bool) $requirement->at_pre_approval,
            'atPostApproval' => (bool) $requirement->at_post_approval,
            'carryForward' => (bool) $requirement->carry_forward,
            'realEstateOnly' => (bool) $requirement->real_estate_only,
            'sortOrder' => (int) $requirement->sort_order,
            'retired' => $requirement->trashed() || ! $requirement->active,
        ];
    }
}
