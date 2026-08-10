<?php

namespace App\Http\Controllers\Cbi;

use App\Http\Controllers\Controller;
use App\Jobs\SyncSmartsheetSheet;
use App\Models\CbiApplication;
use App\Models\CbiComment;
use App\Models\SmartsheetAttachment;
use App\Models\SmartsheetSheet;
use App\Models\SmartsheetSyncLog;
use App\Support\Access\Role;
use App\Support\Smartsheet\Client;
use App\Support\Smartsheet\Synchroniser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * CBI — Citizenship by Investment (development preview).
 *
 * Administrator-only while the module beds in. It ships in the SPA shell
 * (/cbi, with a sidebar row and the cbi.view capability) and also as a
 * chromeless preview at /dev/cbi. Every endpoint here 404s — never 403s —
 * unless the FEATURE_CBI flag is on AND the caller is an administrator, so
 * to everyone else the module still does not exist. Role::can() checks the
 * same flag before its admin short-circuit, which keeps the nav row, the
 * page gate and this API in agreement.
 */
class CbiController extends Controller
{
    private function gate(Request $request): void
    {
        abort_unless((bool) config('services.smartsheet.cbi_enabled'), 404);
        abort_unless(Role::isAdmin($request->user()), 404);
    }

    /** GET /dev/cbi — the standalone development preview shell. */
    public function page(Request $request): BinaryFileResponse
    {
        $this->gate($request);

        $path = resource_path('portal-pages/cbi/index.html');
        abort_unless(is_file($path), 404);

        return response()->file($path, [
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
            'Expires' => '0',
        ]);
    }

    /** GET /portal/cbi/summary — stage counts, filter facets, sync health. */
    public function summary(Request $request): JsonResponse
    {
        $this->gate($request);

        $base = CbiApplication::query();

        $stages = [];
        foreach (CbiApplication::STAGES as $stage) {
            $stages[$stage] = (clone $base)->where('stage', $stage)->count();
        }

        $facet = fn (string $column) => (clone $base)
            ->whereNotNull($column)->where($column, '!=', '')
            ->groupBy($column)->orderByRaw('count(*) desc')
            ->selectRaw($column.' as value, count(*) as n')
            ->limit(40)->get();

        return response()->json([
            'stages' => $stages,
            'total' => (clone $base)->count(),
            'needsReview' => (clone $base)->where('needs_review', true)->count(),
            'facets' => [
                'statuses' => $facet('status'),
                'referredBy' => $facet('referred_by'),
                'investmentOptions' => $facet('investment_option'),
                'assigned' => $facet('assigned_to_canonical'),
                'nationalities' => $facet('nationality'),
            ],
            'sync' => [
                'configured' => Client::configured(),
                // max() bypasses the model's datetime cast and returns the
                // raw UTC string, which a browser would parse as local time.
                'lastSuccessAt' => ($last = SmartsheetSheet::query()->max('last_success_at'))
                    ? \Illuminate\Support\Carbon::parse($last)->toIso8601String() : null,
                'sheets' => SmartsheetSheet::query()->where('status', '!=', SmartsheetSheet::STATUS_GONE)->count(),
                'sheetsWithErrors' => SmartsheetSheet::query()->where('status', SmartsheetSheet::STATUS_ERROR)->count(),
                'syncing' => SmartsheetSheet::query()->where('status', SmartsheetSheet::STATUS_SYNCING)->count(),
            ],
        ]);
    }

    /** GET /portal/cbi/applications — filtered, sorted, paginated list. */
    public function applications(Request $request): JsonResponse
    {
        $this->gate($request);

        $query = CbiApplication::query()->with('assignedUser');

        if (($stage = (string) $request->query('stage')) !== ''
            && in_array($stage, CbiApplication::STAGES, true)) {
            $query->where('stage', $stage);
        }
        foreach (['status', 'referred_by', 'investment_option', 'nationality'] as $filter) {
            if (($value = (string) $request->query($filter)) !== '') {
                $query->where($filter, $value);
            }
        }
        // Filtering by a person means all their spellings, so it reads the
        // canonical column the assignee matcher writes — not the raw cell.
        if (($assignee = (string) $request->query('assigned_to')) !== '') {
            $query->where('assigned_to_canonical', $assignee);
        }
        if ($request->boolean('needs_review')) {
            $query->where('needs_review', true);
        }
        if (($from = (string) $request->query('received_from')) !== '') {
            $query->whereDate('received_at', '>=', $from);
        }
        if (($to = (string) $request->query('received_to')) !== '') {
            $query->whereDate('received_at', '<=', $to);
        }

        if (($q = trim((string) $request->query('q'))) !== '') {
            $needle = '%'.strtolower($q).'%';
            $query->where(function ($w) use ($needle) {
                foreach (['applicant_name', 'main_applicant_name', 'applicant_number',
                    'passport_number', 'clio_matter_number', 'referred_by', 'nationality'] as $column) {
                    $w->orWhereRaw('lower('.$column.') like ?', [$needle]);
                }
            });
        }

        $sort = (string) $request->query('sort', 'recent');
        match ($sort) {
            'name' => $query->orderByRaw('lower(coalesce(applicant_name, main_applicant_name, \'\')) asc'),
            'received' => $query->orderByDesc('received_at'),
            'status' => $query->orderBy('status')->orderByDesc('source_modified_at'),
            default => $query->orderByDesc('source_modified_at'),
        };

        $perPage = min(100, max(10, (int) $request->query('per_page', 50)));
        $page = $query->paginate($perPage);

        return response()->json([
            'items' => collect($page->items())->map(fn (CbiApplication $a) => [
                'uuid' => $a->uuid,
                'applicantName' => $a->applicant_name ?? $a->main_applicant_name,
                'applicantNumber' => $a->applicant_number,
                'stage' => $a->stage,
                'status' => $a->status,
                'progress' => $a->progress,
                'referredBy' => $a->referred_by,
                'assignee' => self::assignee($a),
                'investmentOption' => $a->investment_option,
                'nationality' => $a->nationality,
                'dependents' => $a->number_of_dependents,
                'receivedAt' => $a->received_at?->toDateString(),
                'decisionReceivedAt' => $a->decision_received_at?->toDateString(),
                'modifiedAt' => $a->source_modified_at?->toIso8601String(),
                'needsReview' => $a->needs_review,
                'granted' => $a->granted,
            ]),
            'total' => $page->total(),
            'page' => $page->currentPage(),
            'lastPage' => $page->lastPage(),
        ]);
    }

    /** GET /portal/cbi/applications/{uuid} — the full application workspace. */
    public function application(Request $request, string $uuid): JsonResponse
    {
        $this->gate($request);

        $application = CbiApplication::query()->with(['client', 'assignedUser'])->where('uuid', $uuid)->firstOrFail();

        $sources = $application->sources()->get();

        // Attachments hang off the tracker rows that feed this application,
        // plus the linked assessment sheet (row + sheet level).
        $attachments = collect();
        foreach ($sources as $source) {
            $sheet = SmartsheetSheet::query()->where('remote_id', $source->sheet_remote_id)->first();
            if ($sheet) {
                $attachments = $attachments->merge(
                    SmartsheetAttachment::query()
                        ->where('sheet_id', $sheet->id)
                        ->where('parent_remote_id', $source->row_remote_id)
                        ->get()
                );
            }
        }
        $assessmentSheets = SmartsheetSheet::query()
            ->where('cbi_application_id', $application->id)->get();
        foreach ($assessmentSheets as $sheet) {
            $attachments = $attachments->merge(
                SmartsheetAttachment::query()->where('sheet_id', $sheet->id)->get()
            );
        }

        return response()->json([
            'application' => $this->detailPayload($application),
            'sources' => $sources->map(fn ($s) => [
                'sheetName' => $s->sheet_name,
                'category' => $s->sheet_category,
                'modifiedAt' => $s->row_modified_at?->toIso8601String(),
            ]),
            'attachments' => $attachments->unique('id')->values()->map(fn (SmartsheetAttachment $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'mime' => $a->mime_type,
                'sizeKb' => $a->size_kb,
                'by' => $a->created_by,
                'at' => $a->created_at_remote?->toIso8601String(),
                'kind' => $a->attachment_type,
            ]),
            'comments' => $application->comments()
                ->orderBy('commented_at')->get()
                ->map(fn (CbiComment $c) => [
                    'id' => $c->id,
                    'author' => $c->user?->name ?? $c->author_name ?? $c->author_email ?? 'Unknown',
                    'body' => $c->body,
                    'source' => $c->source,
                    'at' => ($c->commented_at ?? $c->created_at)?->toIso8601String(),
                ]),
            'events' => $application->events()
                ->orderByDesc('occurred_at')->limit(150)->get()
                ->map(fn ($e) => [
                    'type' => $e->type,
                    'field' => $e->field,
                    'from' => $e->from_value,
                    'to' => $e->to_value,
                    'source' => $e->source,
                    'actor' => $e->actor?->name ?? $e->actor_name,
                    'at' => ($e->occurred_at ?? $e->created_at)?->toIso8601String(),
                ]),
            'assessment' => $application->assessmentItems()
                ->orderBy('position')->get()
                ->map(fn ($i) => [
                    'label' => $i->applicant_label,
                    'description' => $i->description,
                    'notes' => $i->notes,
                    'agentAssessment' => $i->agent_assessment,
                    'response' => $i->assessment_response,
                    'done' => $i->is_done,
                    'indent' => $i->parent_row_remote_id !== null,
                ]),
        ]);
    }

    /**
     * The person a file is with, as the table needs to draw them: a name to
     * print and a face to put beside it.
     *
     * `assigned_to_canonical` is one spelling per person (see
     * App\Support\Cbi\AssigneeDirectory); the raw cell is kept alongside so a
     * reader can still see what the sheet actually said. Where the colleague
     * has a portal account their real photo comes with them — where they have
     * none, the name alone is enough for the browser to draw initials.
     *
     * @return array<string, mixed>|null
     */
    private static function assignee(CbiApplication $a): ?array
    {
        $name = $a->assigned_to_canonical ?: null;
        $user = $a->relationLoaded('assignedUser') ? $a->assignedUser : null;

        if (! $name && ! $user) {
            return null;
        }

        return [
            'name' => $user?->name ?? $name,
            'email' => $user?->email,
            'photo' => $user?->photoUrl(),
            'userId' => $user?->id,
            // What Smartsheet actually holds, shown only when it differs.
            'raw' => $a->assigned_to !== ($user?->name ?? $name) ? $a->assigned_to : null,
        ];
    }

    /** @return array<string, mixed> */
    private function detailPayload(CbiApplication $a): array
    {
        $date = fn ($d) => $d?->toDateString();

        return [
            'uuid' => $a->uuid,
            'applicantName' => $a->applicant_name ?? $a->main_applicant_name,
            'mainApplicantName' => $a->main_applicant_name,
            'applicantNumber' => $a->applicant_number,
            'dateOfBirth' => $date($a->date_of_birth),
            'nationality' => $a->nationality,
            'dependents' => $a->number_of_dependents,
            'familyStructure' => $a->family_structure,
            'contactDetails' => $a->contact_details,
            'stage' => $a->stage,
            'status' => $a->status,
            'progress' => $a->progress,
            'applicationReview' => $a->application_review,
            'granted' => $a->granted,
            'closed' => $a->closed,
            'actionNeeded' => $a->action_needed,
            'needsReview' => $a->needs_review,
            'referredBy' => $a->referred_by,
            // The applicant's record in the Client hub, once the caseload has
            // been imported. Two keys, because the page needs a name to show
            // and a uid to link to.
            'clientUid' => $a->client?->uid,
            'clientName' => $a->client?->name,
            'promoter' => $a->promoter,
            'serviceProvider' => $a->service_provider,
            'mainContact' => $a->main_contact,
            'assignee' => self::assignee($a),
            'verificationOfficer' => $a->verification_officer,
            'ddOfficer' => $a->dd_officer,
            'paAssignment' => $a->pa_assignment,
            'fileOwner' => $a->file_owner,
            // Never sent before, so the overview's "Submitted by" and
            // "Verified by" rows were always blank whatever the sheet held.
            'submittedBy' => $a->submitted_by,
            'verifiedBy' => $a->verified_by,
            'investmentOption' => $a->investment_option,
            'applicationType' => $a->application_type,
            'clioMatterNumber' => $a->clio_matter_number,
            'clioMatterLink' => $a->clio_matter_link,
            'fileLocation' => $a->file_location,
            'timeline' => [
                'received' => $date($a->received_at),
                'preProcessing' => $date($a->pre_processing_at),
                'submitted' => $date($a->submitted_at),
                'accepted' => $date($a->accepted_at),
                'complianceDue' => $date($a->compliance_due_at),
                'decisionRequired' => $date($a->decision_required_at),
                'decisionReceived' => $date($a->decision_received_at),
                'corSubmitted' => $date($a->cor_submitted_at),
                'corReceived' => $date($a->cor_received_at),
                'nicRequestSent' => $date($a->nic_request_sent_at),
                'nicLetterReceived' => $date($a->nic_letter_received_at),
                'passportPadsReceived' => $date($a->passport_pads_received_at),
                'readyForPassportSubmission' => $date($a->ready_for_passport_submission_at),
                'passportSubmitted' => $date($a->passport_submitted_at),
                'passportReceived' => $date($a->passport_received_at),
                'originalsDelivered' => $date($a->originals_delivered_at),
                'finalDocumentsSent' => $date($a->final_documents_sent_at),
                'appealRequested' => $date($a->appeal_requested_at),
                'appealSent' => $date($a->appeal_sent_at),
                'appealDecided' => $date($a->appeal_decided_at),
            ],
            'corNumber' => $a->cor_number,
            'passportNumber' => $a->passport_number,
            'notes' => $a->notes,
            'latestComment' => $a->latest_comment,
            'issuesLog' => $a->issues_log,
            'agentAssessment' => $a->agent_assessment,
            'assessmentResponse' => $a->assessment_response,
            'financials' => $a->financials,
            'extra' => $a->extra,
            'sourcePermalink' => $a->source_permalink,
            'syncedAt' => $a->synced_at?->toIso8601String(),
        ];
    }

    /** POST /portal/cbi/applications/{uuid}/comments — a portal-side comment. */
    public function storeComment(Request $request, string $uuid): JsonResponse
    {
        $this->gate($request);

        $application = CbiApplication::query()->where('uuid', $uuid)->firstOrFail();

        $data = $request->validate(['body' => ['required', 'string', 'max:8000']]);

        $comment = $application->comments()->create([
            'user_id' => $request->user()->id,
            'body' => $data['body'],
            'source' => 'portal',
            'commented_at' => now(),
        ]);

        $application->events()->create([
            'type' => \App\Models\CbiApplicationEvent::TYPE_COMMENT_ADDED,
            'source' => 'portal',
            'actor_user_id' => $request->user()->id,
            'occurred_at' => now(),
        ]);

        return response()->json([
            'id' => $comment->id,
            'author' => $request->user()->name,
            'body' => $comment->body,
            'source' => 'portal',
            'at' => $comment->commented_at->toIso8601String(),
        ], 201);
    }

    /**
     * GET /portal/cbi/attachments/{attachment} — redirect to a fresh,
     * short-lived Smartsheet download URL. Minted per click and never
     * stored; the token stays server-side.
     */
    public function downloadAttachment(Request $request, SmartsheetAttachment $attachment): RedirectResponse
    {
        $this->gate($request);

        $url = Client::attachmentUrl($attachment->sheet->remote_id, $attachment->remote_id);
        // Only ever follow an https URL: LINK-type "attachments" are
        // collaborator-typed and could name any scheme or host.
        abort_if($url === null || ! str_starts_with($url, 'https://'), 404);

        return redirect()->away($url);
    }

    /** POST /portal/cbi/sync — walk the workspace now and queue changed sheets. */
    public function triggerSync(Request $request): JsonResponse
    {
        $this->gate($request);
        abort_unless(Client::configured(), 422, 'Smartsheet is not configured.');

        $due = Synchroniser::refreshWorkspace((string) Str::uuid());
        foreach ($due as $sheet) {
            SyncSmartsheetSheet::dispatch($sheet);
        }

        return response()->json(['queued' => count($due)]);
    }

    /** GET /portal/cbi/sync — sheet-by-sheet sync health + recent log lines. */
    public function syncStatus(Request $request): JsonResponse
    {
        $this->gate($request);

        return response()->json([
            'sheets' => SmartsheetSheet::query()
                ->orderByDesc('modified_at_remote')
                ->get()
                ->map(fn (SmartsheetSheet $s) => [
                    'name' => $s->name,
                    'folder' => $s->folder_path,
                    'category' => $s->category,
                    'status' => $s->status,
                    'rows' => $s->row_count,
                    'version' => $s->version,
                    'syncedVersion' => $s->synced_version,
                    'lastSuccessAt' => $s->last_success_at?->toIso8601String(),
                    'lastError' => $s->last_error,
                ]),
            'log' => SmartsheetSyncLog::query()
                ->orderByDesc('id')->limit(100)->get()
                ->map(fn ($l) => [
                    'action' => $l->action,
                    'level' => $l->level,
                    'detail' => $l->detail,
                    'at' => $l->created_at?->toIso8601String(),
                ]),
        ]);
    }
}
