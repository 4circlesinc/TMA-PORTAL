<?php

namespace App\Http\Controllers\Cbi;

use App\Http\Controllers\Controller;
use App\Jobs\SyncCbiHub;
use App\Jobs\SyncSmartsheetSheet;
use App\Models\CbiApplication;
use App\Models\CbiApplicationEvent;
use App\Models\CbiApplicationSource;
use App\Models\CbiComment;
use App\Models\SmartsheetAttachment;
use App\Models\SmartsheetSheet;
use App\Models\SmartsheetSyncLog;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cbi\DocumentImporter;
use App\Support\Cbi\Names;
use App\Support\Cbi\SyncActor;
use App\Support\Imports\ImportPause;
use App\Support\Smartsheet\Client;
use App\Support\Smartsheet\Synchroniser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * CBI. Citizenship by Investment (development preview).
 *
 * Administrator-only while the module beds in. It is a chromeless preview
 * at /dev/cbi. Every endpoint here 404s, never 403s — unless the FEATURE_CBI
 * flag is on AND the caller is an administrator, so to everyone else the
 * module still does not exist. Role::can() checks the same flag before its
 * admin short-circuit, which keeps the page gate and this API in agreement.
 */
class CbiController extends Controller
{
    private function gate(Request $request): void
    {
        abort_unless((bool) config('services.smartsheet.cbi_enabled'), 404);
        abort_unless(Role::isAdmin($request->user()), 404);
    }

    /** GET /dev/cbi, the standalone development preview shell. */
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

    /** Warm summary aggregates briefly, mount + 15s doc polls share them. */
    private const SUMMARY_TTL_SECONDS = 20;

    /** GET /portal/cbi/summary, stage counts, filter facets, sync health. */
    public function summary(Request $request): JsonResponse
    {
        $this->gate($request);

        // Documents ride outside the cache: their survey is already short-lived
        // and "active" must flip as soon as a batch lands.
        $core = Cache::remember('cbi.summary.core', self::SUMMARY_TTL_SECONDS, function () {
            // One GROUP BY instead of a count() per stage.
            $stageCounts = CbiApplication::query()
                ->selectRaw('stage, count(*) as n')
                ->groupBy('stage')
                ->pluck('n', 'stage');

            $stages = [];
            foreach (CbiApplication::STAGES as $stage) {
                $stages[$stage] = (int) ($stageCounts[$stage] ?? 0);
            }

            $facet = fn (string $column) => CbiApplication::query()
                ->whereNotNull($column)->where($column, '!=', '')
                ->groupBy($column)->orderByRaw('count(*) desc')
                ->selectRaw($column.' as value, count(*) as n')
                ->limit(40)->get()
                ->map(fn ($row) => ['value' => $row->value, 'n' => (int) $row->n])
                ->values()
                ->all();

            // Conditional aggregates in one pass. CASE works on Postgres and SQLite.
            $sheetStats = SmartsheetSheet::query()
                ->selectRaw(
                    'sum(case when status != ? then 1 else 0 end) as sheets,'.
                    'sum(case when status = ? then 1 else 0 end) as sheets_with_errors,'.
                    'sum(case when status = ? then 1 else 0 end) as syncing,'.
                    'max(last_success_at) as last_success_at',
                    [
                        SmartsheetSheet::STATUS_GONE,
                        SmartsheetSheet::STATUS_ERROR,
                        SmartsheetSheet::STATUS_SYNCING,
                    ]
                )
                ->first();

            return [
                'stages' => $stages,
                'total' => CbiApplication::query()->count(),
                'needsReview' => CbiApplication::query()->where('needs_review', true)->count(),
                'facets' => [
                    'statuses' => $facet('status'),
                    'referredBy' => $facet('referred_by'),
                    'investmentOptions' => $facet('investment_option'),
                    'assigned' => $facet('assigned_to_canonical'),
                    'nationalities' => $facet('nationality'),
                ],
                'sync' => [
                    'configured' => Client::configured(),
                    'lastSuccessAt' => ! empty($sheetStats?->last_success_at)
                        ? Carbon::parse($sheetStats->last_success_at)->toIso8601String()
                        : null,
                    'sheets' => (int) ($sheetStats->sheets ?? 0),
                    'sheetsWithErrors' => (int) ($sheetStats->sheets_with_errors ?? 0),
                    'syncing' => (int) ($sheetStats->syncing ?? 0),
                ],
            ];
        });

        return response()->json($core + [
            // Smartsheet → File Library copy. Shown on the page so the office
            // can see how much paperwork is still landing in client folders.
            'documents' => $this->documentImportProgress($request),
        ]);
    }

    /** GET /portal/cbi/applications, filtered, sorted, paginated list. */
    public function applications(Request $request): JsonResponse
    {
        $this->gate($request);

        // assignedUser is unused in the list payload (casePeople resolves staff
        // by name); skipping the eager load saves a join on every page.
        $query = CbiApplication::query();

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
        // canonical column the assignee matcher writes, not the raw cell.
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

        $perPage = min(100, max(10, (int) $request->query('per_page', 100)));
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
                'people' => self::casePeople($a),
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

    /** GET /portal/cbi/applications/{uuid}, the full application workspace. */
    public function application(Request $request, string $uuid): JsonResponse
    {
        $this->gate($request);

        $application = CbiApplication::query()->with(['client.folder', 'assignedUser'])->where('uuid', $uuid)->firstOrFail();

        $sources = $application->sources()->get();
        $attachments = $this->attachmentsFor($application, $sources);

        return response()->json([
            'application' => $this->detailPayload($application),
            'sources' => $sources->map(fn ($s) => [
                'sheetName' => $s->sheet_name,
                'category' => $s->sheet_category,
                'modifiedAt' => $s->row_modified_at?->toIso8601String(),
            ]),
            'attachments' => $attachments->values()->map(fn (SmartsheetAttachment $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'mime' => $a->mime_type,
                'sizeKb' => $a->size_kb,
                'by' => $a->created_by,
                'at' => $a->created_at_remote?->toIso8601String(),
                'kind' => $a->attachment_type,
                // Set once the document has been mirrored into the client's
                // File Library folder: the page opens it in the portal's
                // viewer rather than sending the reader to Smartsheet.
                'fileId' => $a->file?->uuid,
            ]),
            // Pending FILE attachments still waiting to land in the client folder.
            'pendingDocuments' => $attachments
                ->filter(fn (SmartsheetAttachment $a) => $a->attachment_type === 'FILE' && $a->file_id === null)
                ->count(),
            // Where those files live, so the Documents tab browses the same
            // folder the Client hub shows, one library, two doors.
            'folderUuid' => $application->client?->folder?->uuid,
            'comments' => $application->comments()
                ->with('user:id,name')
                ->orderBy('commented_at')->get()
                ->map(fn (CbiComment $c) => [
                    'id' => $c->id,
                    'author' => $c->user?->name ?? $c->author_name ?? $c->author_email ?? 'Unknown',
                    'body' => $c->body,
                    'source' => $c->source,
                    'at' => ($c->commented_at ?? $c->created_at)?->toIso8601String(),
                ]),
            'events' => $application->events()
                ->with('actor:id,name')
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
     * has a portal account their real photo comes with them, where they have
     * none, the name alone is enough for the browser to draw initials.
     *
     * @return array<string, mixed>|null
     */
    /**
     * Everyone on a case, deduped, in the order the office reads them.
     *
     * A file is rarely one person's: the same colleague is often assigned and
     * the file owner, while verification and due diligence sit with others.
     * Both the table and the case page draw from this so a row and the record
     * it opens cannot disagree about who has it.
     *
     * `assigned_to_canonical` is one spelling per person (see
     * App\Support\Cbi\AssigneeDirectory); the other roles are raw sheet text
     * and are matched to a portal account by name where one exists, that is
     * what gives a face and, on the case page, somebody to message.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function casePeople(CbiApplication $a): array
    {
        $roles = [
            ['Assigned', $a->assigned_to_canonical ?: $a->assigned_to],
            ['Verification officer', $a->verification_officer],
            ['Due diligence officer', $a->dd_officer],
            ['PA assignment', $a->pa_assignment],
            ['File owner', $a->file_owner],
            ['Submitted by', $a->submitted_by],
            ['Verified by', $a->verified_by],
        ];

        $staff = self::staffByName();
        $people = [];

        foreach ($roles as [$role, $raw]) {
            $name = trim((string) $raw);
            if ($name === '' || Names::isEmptyMarker($name)) {
                continue;
            }

            $key = Names::normalise($name);
            if (isset($people[$key])) {
                // One person wearing several hats is one person.
                $people[$key]['roles'][] = $role;

                continue;
            }

            $user = $staff[$key] ?? null;
            $people[$key] = [
                'name' => $user['name'] ?? Names::tidy($name),
                'roles' => [$role],
                'email' => $user['email'] ?? null,
                'photo' => $user['photo'] ?? null,
                'userId' => $user['id'] ?? null,
            ];
        }

        // The first name is what both surfaces print; send it rather than make
        // two clients agree on how to split a name.
        return array_values(array_map(function (array $p) {
            $p['first'] = explode(' ', $p['name'])[0];

            return $p;
        }, $people));
    }

    /**
     * Staff directory keyed by normalised name.
     *
     * Cached as plain arrays, never Eloquent models: the file cache cannot
     * reliably unserialize a Collection, and the leftover object became the
     * list endpoint's "Server Error". Thirteen rows; the map is cheap.
     *
     * @return array<string, array{id: int, name: string, email: ?string, photo: ?string}>
     */
    private static function staffByName(): array
    {
        $rows = Cache::remember('cbi.staff-directory', 300, function () {
            Cache::forget('cbi.staff-users');

            return User::whereIn('account_type', Role::STAFF)
                ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url'])
                ->map(fn ($user) => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'photo' => $user->photoUrl(),
                ])
                ->all();
        });

        $byName = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            if (! is_array($row)) {
                continue;
            }
            $name = Names::normalise((string) ($row['name'] ?? ''));
            if ($name !== '') {
                $byName[$name] = $row;
            }
        }

        return $byName;
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
            'people' => self::casePeople($a),
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

    /** POST /portal/cbi/applications/{uuid}/comments, a portal-side comment. */
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
            'type' => CbiApplicationEvent::TYPE_COMMENT_ADDED,
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
     * GET /portal/cbi/attachments/{attachment}, redirect to a fresh,
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

    /** POST /portal/cbi/sync, walk the workspace now and queue changed sheets. */
    public function triggerSync(Request $request): JsonResponse
    {
        $this->gate($request);
        abort_unless(Client::configured(), 422, 'Smartsheet is not configured.');
        abort_unless(! ImportPause::smartsheet(), 422, 'Smartsheet imports are paused. Resume them in Settings → Background Operations.');

        $due = Synchroniser::refreshWorkspace((string) Str::uuid());
        foreach ($due as $sheet) {
            SyncSmartsheetSheet::dispatch($sheet);
        }

        // After the mirror updates, file each applicant under Clients and copy
        // Smartsheet attachments into that person's folder, the same bytes the
        // Documents tab and the File Library lightbox open.
        SyncCbiHub::dispatch($request->user()?->id)->delay(now()->addSeconds(30));

        return response()->json([
            'queued' => count($due),
            'hubQueued' => true,
        ]);
    }

    /** GET /portal/cbi/sync, sheet-by-sheet sync health + recent log lines. */
    public function syncStatus(Request $request): JsonResponse
    {
        $this->gate($request);

        return response()->json([
            'documents' => $this->documentImportProgress($request),
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

    /**
     * Attachments for one application, loaded in two queries rather than one
     * per source row (the previous path was a classic N+1 on open).
     *
     * @param  Collection<int, CbiApplicationSource>  $sources
     * @return Collection<int, SmartsheetAttachment>
     */
    private function attachmentsFor(CbiApplication $application, $sources)
    {
        $remoteIds = $sources->pluck('sheet_remote_id')->filter()->unique()->values();
        $sheetsByRemote = $remoteIds->isEmpty()
            ? collect()
            : SmartsheetSheet::query()->whereIn('remote_id', $remoteIds)->get()->keyBy('remote_id');

        $assessmentSheets = SmartsheetSheet::query()
            ->where('cbi_application_id', $application->id)
            ->get();

        $sheetIds = $sheetsByRemote->pluck('id')
            ->merge($assessmentSheets->pluck('id'))
            ->unique()
            ->values();

        if ($sheetIds->isEmpty()) {
            return collect();
        }

        $allowedPairs = [];
        foreach ($sources as $source) {
            $sheet = $sheetsByRemote->get($source->sheet_remote_id);
            if ($sheet) {
                $allowedPairs[$sheet->id.':'.$source->row_remote_id] = true;
            }
        }

        $assessmentIds = $assessmentSheets->pluck('id')->flip()->all();

        return SmartsheetAttachment::query()
            ->with('file:id,uuid')
            ->whereIn('sheet_id', $sheetIds)
            ->get()
            ->filter(function (SmartsheetAttachment $a) use ($allowedPairs, $assessmentIds) {
                if (isset($assessmentIds[$a->sheet_id])) {
                    return true;
                }

                return isset($allowedPairs[$a->sheet_id.':'.$a->parent_remote_id]);
            })
            ->unique('id')
            ->values();
    }

    /**
     * How far Smartsheet attachments have been filed into client folders.
     *
     * @return array{done: int, pending: int, orphaned: int, clients: int, total: int, percent: int, active: bool, sizeKb: int}
     */
    private function documentImportProgress(Request $request): array
    {
        $actor = SyncActor::resolve($request->user());
        if (! $actor) {
            return [
                'done' => 0,
                'pending' => 0,
                'orphaned' => 0,
                'clients' => 0,
                'total' => 0,
                'percent' => 0,
                'active' => false,
                'sizeKb' => 0,
            ];
        }

        $survey = (new DocumentImporter($actor))->survey();
        $pending = max(0, $survey['files'] - $survey['orphaned']);
        $total = $pending + $survey['done'];

        return [
            'done' => $survey['done'],
            'pending' => $pending,
            'orphaned' => $survey['orphaned'],
            'clients' => $survey['clients'],
            'total' => $total,
            'percent' => $total > 0 ? (int) round(($survey['done'] / $total) * 100) : 100,
            'active' => $pending > 0,
            'sizeKb' => $survey['sizeKb'],
        ];
    }
}
