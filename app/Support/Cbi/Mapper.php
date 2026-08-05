<?php

namespace App\Support\Cbi;

use App\Models\CbiApplication;
use App\Models\CbiApplicationEvent;
use App\Models\CbiApplicationSource;
use App\Models\CbiComment;
use App\Models\SmartsheetDiscussion;
use App\Models\SmartsheetRow;
use App\Models\SmartsheetSheet;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Mirror → CBI domain. Pure data transformation: reads smartsheet_* tables,
 * writes cbi_* tables, touches no network. Re-runnable at any time — the
 * whole point of landing raw data first is that mapping mistakes are fixed
 * by editing this class and re-running, never by re-walking the API.
 *
 * One application per citizenship file: rows for the same applicant on the
 * master tracker, the COR/NIC/passport trackers and a closed sheet merge via
 * a dedupe key, sources ordered so the most authoritative row wins each
 * field it actually fills while lower-priority rows fill the gaps.
 */
class Mapper
{
    /**
     * Portal field => candidate column titles (normalised), first hit wins.
     * Misspellings ('PRE-PROOCESSDING', 'ORIGNALS') are Smartsheet's, kept
     * deliberately — this maps the sheets as they are, not as they should be.
     */
    private const FIELDS = [
        'applicant_number' => ['APPLICANT NUMBER'],
        'applicant_name' => ['APPLICANT NAME', 'APPLICANT'],
        'main_applicant_name' => ['MAIN APPLICANT NAME'],
        'date_of_birth' => ['DATE OF BIRTH'],
        'nationality' => ['NATIONALITY'],
        'number_of_dependents' => ['NUMBER OF DEPENDENTS'],
        'family_structure' => ['FAMILY STRUCTURE'],
        'contact_details' => ['CONTACT DETAILS'],
        'status' => ['STATUS'],
        'application_review' => ['APPLICATION REVIEW'],
        'progress' => ['PROGRESS'],
        'granted' => ['GRANTED'],
        'closed' => ['CLOSED'],
        'action_needed' => ['ACTION NEEDED'],
        'referred_by' => ['REFERRED BY'],
        'promoter' => ['PROMOTER', 'PROMOTER/MARKETING AGENT'],
        'service_provider' => ['SERVICE PROVIDER', 'PROVIDER'],
        'main_contact' => ['MAIN CONTACT'],
        'assigned_to' => ['ASSIGNED', 'ASSIGNED TO'],
        'verification_officer' => ['VERIFICATION OFFICER'],
        'dd_officer' => ['DUE DILIGENCE OFFICER'],
        'pa_assignment' => ['PA ASSIGNMENT'],
        'file_owner' => ['FILE OWNER', 'OWNED BY'],
        'submitted_by' => ['SUBMITTED BY'],
        'verified_by' => ['VERIFIED BY'],
        'investment_option' => ['INVESTMENT OPTION'],
        'application_type' => ['APPLICATION TYPE'],
        'clio_matter_number' => ['CLIO MATTER NUMBER', 'CLIO MATTER'],
        'clio_matter_link' => ['CLIO MATTER LINK'],
        'file_location' => ['FILE LOCATION'],
        'received_at' => ['RECEIVED'],
        'pre_processing_at' => ['PRE PROCESSING DATE', 'PRE-PROOCESSING DATE'],
        'submitted_at' => ['SUBMITTED'],
        'accepted_at' => ['ACCEPTED FOR PROCESSING'],
        'compliance_due_at' => ['COMPLIANCE DUE'],
        'decision_required_at' => ['DECISION REQUIRED'],
        'decision_received_at' => ['DECISION RECEIVED'],
        'cor_submitted_at' => ['COR APPLICATION SUBMITTED', 'COR APPLICATION SENT'],
        'cor_received_at' => ['COR RECEIVED'],
        'cor_number' => ['COR NUMBER'],
        'nic_request_sent_at' => ['NIC REQUEST SENT'],
        'nic_letter_received_at' => ['NIC LETTER RECEIVED'],
        'passport_pads_received_at' => ['PASSPORT PADS RECEIVED'],
        'ready_for_passport_submission_at' => ['READY FOR PASSPORT SUBMISSION'],
        'passport_submitted_at' => ['PASSPORT APPLICATION SUBMITTED'],
        'passport_received_at' => ['PASSPORTS RECEIVED BY TMA', 'PASSPORT RECEIVED BY TMA'],
        'passport_number' => ['PASSPORT NUMBER'],
        'originals_delivered_at' => ['ORIGINALS DELIVERED TO CLIENT', 'ORIGNALS DELIVERED TO CLIENT'],
        'final_documents_sent_at' => ['FINAL DOCUMENTS SENT'],
        'appeal_requested_at' => ['APPEAL REQUEST FROM APPLICANT'],
        'appeal_sent_at' => ['APPEAL SENT / QUERY MADE'],
        'appeal_decided_at' => ['APPEAL DECIDED'],
        'notes' => ['NOTES'],
        'latest_comment' => ['LATEST COMMENT', 'LATEST COMMENTS'],
        'issues_log' => ['ISSUES LOG', 'ISSUES LOG - FROM PASSPORT OFFICE'],
        'agent_assessment' => ['AGENT ASSESSMENT'],
        'assessment_response' => ['ASSESSMENT RESPONSE'],
    ];

    private const DATE_FIELDS = [
        'date_of_birth', 'received_at', 'pre_processing_at', 'submitted_at', 'accepted_at',
        'compliance_due_at', 'decision_required_at', 'decision_received_at',
        'cor_submitted_at', 'cor_received_at', 'nic_request_sent_at', 'nic_letter_received_at',
        'passport_pads_received_at', 'ready_for_passport_submission_at', 'passport_submitted_at',
        'passport_received_at', 'originals_delivered_at', 'final_documents_sent_at',
        'appeal_requested_at', 'appeal_sent_at', 'appeal_decided_at',
    ];

    private const BOOL_FIELDS = ['granted', 'closed'];

    /** Money-shaped columns, grouped into the `financials` JSON bag. */
    private const FINANCIAL_TITLES = [
        'UNIT COST', 'ADDED COST', 'TOTAL COST', 'EC AMOUNT', 'EC PD', 'INVOICE NUMBER', 'INVOICE PAID',
        'TMA INVOICES SENT', 'TMA PF INVOICE NUMBER', 'TMA INVOICE AMOUNT', 'TMA INVOICE DATE SENT',
        'TMA INVOICE PAID', 'TMA INVOICE DATE CLEARED', 'TMA INVOICE NUMBER', 'TMA INVOICE SENT',
        'DD INVOICE NUMBER', 'DD INVOICE AMOUNT', 'DD INVOICE SENT', 'DD RECEIPT SENT', 'DD RECEIPT SENT DATE',
        'ADMIN FEE AMOUNT', 'ADMIN FEES PAID', 'ADMIN FEES RECEIPT SENT', 'ADMIN FEE INVOICE NUMBER',
        'ADMIN FEES / INVESTMENT PAID', 'ADMIN FEES / INVESTMENT RECEIPT SENT',
        'AGENT FEES', 'BANK SCREENING FEE', 'CIP FEES INVOICE AMOUNT', 'POST APPROVAL FEES',
        'TOTAL INVOICE', 'INVESTMENT AMOUNT', 'FEES INVOICE SENT', 'FEES RECEIPT SENT',
        'INVESTMENT PAID', 'INVESTMENT RECEIPT SENT', 'PAYMENT 1 RECEIVED', 'PAYMENT 2 RECEIVED',
        'BANK FEES DEDUCTED', '1ST PAYMENT', '2ND PAYMENT', 'APPEAL INVOICE NUMBER',
        'APPEAL INVOICE SENT', 'APPEAL INVOICE PAID', 'RECONCILED', 'PASSPORT FEES PAID',
        'RECEIPT DELIVERED', 'RECEIPT SENT', 'POP SENT TO UNIT', 'POP SENT TO THE UNIT',
    ];

    /** Smartsheet statuses that mean the file is done, whatever sheet it sits on. */
    private const CLOSED_STATUSES = ['CLOSED', 'WITHDRAWN', 'DENIED', 'RESCINDED'];

    private const STAGE_BY_STATUS = [
        'NEW' => CbiApplication::STAGE_APPLICATIONS,
        'DRAFT' => CbiApplication::STAGE_APPLICATIONS,
        'APPLICATION REVIEW' => CbiApplication::STAGE_APPLICATIONS,
        'ADDITIONAL INFORMATION' => CbiApplication::STAGE_APPLICATIONS,
        'PRE PROCESSING' => CbiApplication::STAGE_APPLICATIONS,
        'TO SUBMIT' => CbiApplication::STAGE_APPLICATIONS,
        'PENDING REVIEW' => CbiApplication::STAGE_ASSESSMENT,
        'ASSESSED' => CbiApplication::STAGE_ASSESSMENT,
        'BACKGROUND CHECK' => CbiApplication::STAGE_ASSESSMENT,
        'QUERIES - BACKGROUND CHECK' => CbiApplication::STAGE_ASSESSMENT,
    ];

    /** Higher wins field conflicts; the live pipeline outranks archives. */
    private const CATEGORY_PRIORITY = [
        SmartsheetSheet::CATEGORY_MASTER_TRACKER => 40,
        SmartsheetSheet::CATEGORY_SUBMISSION => 30,
        SmartsheetSheet::CATEGORY_PENDING_REVIEW => 20,
        SmartsheetSheet::CATEGORY_CLOSED => 10,
    ];

    /**
     * Map everything a sheet feeds. Called after each sheet sync and by the
     * cbi:remap command.
     */
    public static function mapSheet(SmartsheetSheet $sheet): void
    {
        if ($sheet->mapsToApplications()) {
            self::mapApplicationSheet($sheet);
            self::importComments($sheet);
        } elseif ($sheet->category === SmartsheetSheet::CATEGORY_ASSESSMENT) {
            self::mapAssessmentSheet($sheet);
        }
    }

    private static function mapApplicationSheet(SmartsheetSheet $sheet): void
    {
        $titles = self::titleMap($sheet);

        $sheet->rows()->orderBy('row_number')->chunk(200, function ($rows) use ($sheet, $titles) {
            foreach ($rows as $row) {
                try {
                    self::applyRow($sheet, $row, $titles);
                } catch (Throwable $e) {
                    // One malformed row must not sink the sheet.
                    Log::warning('CBI map failed for row', [
                        'sheet' => $sheet->remote_id, 'row' => $row->remote_id, 'error' => $e->getMessage(),
                    ]);
                }
            }
        });

        // Rows that left this sheet (moved to closed, deleted) lose their
        // source link; an application with no sources left is retired.
        $liveIds = $sheet->rows()->pluck('remote_id');
        $stale = CbiApplicationSource::query()
            ->where('sheet_remote_id', $sheet->remote_id)
            ->whereNotIn('row_remote_id', $liveIds)
            ->get();
        foreach ($stale as $source) {
            $application = $source->application;
            $source->delete();
            if ($application && $application->sources()->count() === 0) {
                $application->delete(); // soft delete — recoverable
            } elseif ($application) {
                self::rebuild($application);
            }
        }
    }

    /**
     * @param  array<string, list<string>>  $titles normalised title => [columnRemoteId,...]
     */
    private static function applyRow(SmartsheetSheet $sheet, SmartsheetRow $row, array $titles): void
    {
        $fields = self::extractFields($row->cells ?? [], $titles);

        $dedupe = self::dedupeKey($fields, $sheet, $row);

        $source = CbiApplicationSource::query()
            ->where('sheet_remote_id', $sheet->remote_id)
            ->where('row_remote_id', $row->remote_id)
            ->first();

        // Fast skip: row unchanged since this source last fed its application.
        if ($source && $source->row_modified_at !== null
            && $row->modified_at_remote !== null
            && ! $row->modified_at_remote->gt($source->row_modified_at)) {
            $source->update(['last_seen_at' => now()]);

            return;
        }

        $byKey = $dedupe['key'] !== null
            ? CbiApplication::query()->where('dedupe_key', $dedupe['key'])->first()
            : null;

        $application = $byKey ?? $source?->application;

        if ($source && $byKey && $source->application_id !== $byKey->id) {
            // The row's identity changed (a number was filled in later) and
            // now matches a different application: move the source across and
            // retire the old application if this row was all it had.
            $orphan = $source->application;
            $source->application_id = $byKey->id;
            $source->save();
            if ($orphan && $orphan->sources()->count() === 0) {
                $orphan->delete();
            }
            $application = $byKey;
        }

        if ($application === null) {
            $application = CbiApplication::create([
                'dedupe_key' => $dedupe['key'],
                'needs_review' => $dedupe['needs_review'],
                'first_imported_at' => now(),
            ]);
            $application->events()->create([
                'type' => CbiApplicationEvent::TYPE_IMPORTED,
                'source' => 'smartsheet',
                'to_value' => $sheet->name,
                'occurred_at' => $row->modified_at_remote ?? now(),
            ]);
        }

        CbiApplicationSource::updateOrCreate(
            ['sheet_remote_id' => $sheet->remote_id, 'row_remote_id' => $row->remote_id],
            [
                'application_id' => $application->id,
                'sheet_name' => $sheet->name,
                'sheet_category' => $sheet->category,
                'row_modified_at' => $row->modified_at_remote,
                'last_seen_at' => now(),
            ],
        );

        self::rebuild($application->fresh());
    }

    /**
     * Recompute an application from every row that feeds it. Sources apply
     * in ascending authority so the most authoritative row's non-empty
     * values land last; empty cells never erase what another row knows.
     */
    public static function rebuild(CbiApplication $application): void
    {
        $sources = $application->sources()->get()
            ->sortBy(fn (CbiApplicationSource $s) => [
                self::CATEGORY_PRIORITY[$s->sheet_category] ?? 0,
                $s->row_modified_at?->getTimestamp() ?? 0,
            ])
            ->values();

        if ($sources->isEmpty()) {
            $application->delete();

            return;
        }

        $before = [
            'stage' => $application->stage,
            'status' => $application->status,
            'assigned_to' => $application->assigned_to,
        ];

        $merged = [];
        $financials = [];
        $extra = [];
        $authoritative = null;
        $authoritativeSheet = null;

        foreach ($sources as $sourceRecord) {
            $sheet = SmartsheetSheet::query()->where('remote_id', $sourceRecord->sheet_remote_id)->first();
            $row = $sheet?->rows()->where('remote_id', $sourceRecord->row_remote_id)->first();
            if ($sheet === null || $row === null) {
                continue;
            }
            $titles = self::titleMap($sheet);
            $fields = self::extractFields($row->cells ?? [], $titles);
            foreach ($fields as $key => $value) {
                if ($value !== null && $value !== '') {
                    $merged[$key] = $value;
                }
            }
            $financials = array_merge($financials, self::bagValues($row->cells ?? [], $titles, self::FINANCIAL_TITLES));
            $extra = array_merge($extra, self::extraValues($row->cells ?? [], $sheet));
            $authoritative = $row;
            $authoritativeSheet = $sheet;
        }

        $attrs = self::castFields($merged);
        $attrs['financials'] = $financials === [] ? null : $financials;
        $attrs['extra'] = $extra === [] ? null : $extra;
        $attrs['stage'] = self::deriveStage($attrs, $authoritativeSheet);
        $attrs['source_sheet_remote_id'] = $authoritativeSheet?->remote_id;
        $attrs['source_row_remote_id'] = $authoritative?->remote_id;
        $attrs['source_permalink'] = $authoritative?->permalink;
        $attrs['source_modified_at'] = $authoritative?->modified_at_remote;
        $attrs['synced_at'] = now();

        $application->fill($attrs)->save();

        self::recordDiff($application, $before, $authoritative?->modified_at_remote);
    }

    /** @param array<string, mixed> $before */
    private static function recordDiff(CbiApplication $application, array $before, ?CarbonImmutable $occurredAt): void
    {
        $diffs = [
            'stage' => CbiApplicationEvent::TYPE_STAGE_CHANGED,
            'status' => CbiApplicationEvent::TYPE_STATUS_CHANGED,
            'assigned_to' => CbiApplicationEvent::TYPE_ASSIGNED,
        ];
        foreach ($diffs as $field => $type) {
            $old = $before[$field];
            $new = $application->{$field};
            if ($old !== null && $old !== $new) {
                $application->events()->create([
                    'type' => $type,
                    'field' => $field,
                    'from_value' => $old,
                    'to_value' => $new,
                    'source' => 'smartsheet',
                    'occurred_at' => $occurredAt ?? now(),
                ]);
            }
        }
    }

    /**
     * The four-lane pipeline. A closed marker anywhere wins; then
     * Smartsheet's own status label; then the sheet's category default.
     */
    private static function deriveStage(array $attrs, ?SmartsheetSheet $authoritativeSheet): string
    {
        $status = strtoupper(trim((string) ($attrs['status'] ?? '')));

        if (($attrs['closed'] ?? false) === true
            || in_array($status, self::CLOSED_STATUSES, true)
            || $authoritativeSheet?->category === SmartsheetSheet::CATEGORY_CLOSED) {
            return CbiApplication::STAGE_CLOSED;
        }

        if ($status !== '' && isset(self::STAGE_BY_STATUS[$status])) {
            return self::STAGE_BY_STATUS[$status];
        }

        if ($status !== '') {
            // Every remaining live status (SUBMITTED, DECISION PENDING,
            // GRANTED, POST APPROVAL, CITIZEN, COR/NIC/PASSPORT…) is the
            // in-flight pipeline.
            return CbiApplication::STAGE_TRACKER;
        }

        return match ($authoritativeSheet?->category) {
            SmartsheetSheet::CATEGORY_PENDING_REVIEW => CbiApplication::STAGE_ASSESSMENT,
            SmartsheetSheet::CATEGORY_SUBMISSION => CbiApplication::STAGE_APPLICATIONS,
            default => CbiApplication::STAGE_TRACKER,
        };
    }

    /** @return array{key: ?string, needs_review: bool} */
    private static function dedupeKey(array $fields, SmartsheetSheet $sheet, SmartsheetRow $row): array
    {
        $number = strtoupper(preg_replace('/\s+/', '', (string) ($fields['applicant_number'] ?? '')));
        if ($number !== '') {
            return ['key' => 'N:'.$number, 'needs_review' => false];
        }

        $name = Str::slug((string) ($fields['applicant_name'] ?? $fields['main_applicant_name'] ?? ''));
        $dob = (string) ($fields['date_of_birth'] ?? '');
        if ($name !== '' && $dob !== '') {
            return ['key' => 'D:'.$name.'|'.$dob, 'needs_review' => false];
        }
        if ($name !== '') {
            // Name alone is a weak identity — merge, but flag for a human.
            return ['key' => 'M:'.$name, 'needs_review' => true];
        }

        // No identity at all: this row stands alone, keyed to itself.
        return ['key' => 'R:'.$sheet->remote_id.':'.$row->remote_id, 'needs_review' => true];
    }

    // ── Cell extraction ──────────────────────────────────────────────

    /** @return array<string, list<int>> normalised title => column remote ids (in position order) */
    private static function titleMap(SmartsheetSheet $sheet): array
    {
        static $cache = [];
        if (isset($cache[$sheet->id])) {
            return $cache[$sheet->id];
        }

        $map = [];
        foreach ($sheet->columns()->orderBy('position')->get() as $column) {
            $map[self::normaliseTitle($column->title)][] = (int) $column->remote_id;
        }

        return $cache[$sheet->id] = $map;
    }

    private static function normaliseTitle(string $title): string
    {
        return strtoupper(trim(preg_replace('/\s+/', ' ', $title)));
    }

    /** @return array<string, mixed> raw (uncast) portal fields present on this row */
    private static function extractFields(array $cells, array $titles): array
    {
        $out = [];
        foreach (self::FIELDS as $field => $candidates) {
            foreach ($candidates as $candidate) {
                foreach ($titles[$candidate] ?? [] as $columnId) {
                    $value = self::cellValue($cells, $columnId);
                    if ($value !== null && $value !== '') {
                        $out[$field] = $value;
                        continue 3;
                    }
                }
            }
        }

        return $out;
    }

    /** Collect listed titles into a bag keyed by canonical title. */
    private static function bagValues(array $cells, array $titles, array $wanted): array
    {
        $bag = [];
        foreach ($wanted as $title) {
            foreach ($titles[$title] ?? [] as $columnId) {
                $value = self::cellValue($cells, $columnId);
                if ($value !== null && $value !== '') {
                    $bag[$title] = $value;
                    break;
                }
            }
        }

        return $bag;
    }

    /**
     * Everything populated that neither the field map nor the financial bag
     * consumed — imported for completeness, shown only in the detail view.
     */
    private static function extraValues(array $cells, SmartsheetSheet $sheet): array
    {
        static $consumed = null;
        if ($consumed === null) {
            $consumed = self::FINANCIAL_TITLES;
            foreach (self::FIELDS as $candidates) {
                $consumed = array_merge($consumed, $candidates);
            }
            $consumed = array_flip($consumed);
        }

        $extra = [];
        foreach ($sheet->columns as $column) {
            $title = self::normaliseTitle($column->title);
            if (isset($consumed[$title]) || str_starts_with($title, 'COLUMN')) {
                continue;
            }
            $value = self::cellValue($cells, (int) $column->remote_id);
            if ($value !== null && $value !== '') {
                $extra[trim($column->title)] = $value;
            }
        }

        return $extra;
    }

    private static function cellValue(array $cells, int $columnId): mixed
    {
        $cell = $cells[(string) $columnId] ?? null;
        if ($cell === null) {
            return null;
        }
        // Display value first for people/picklists (names, not emails);
        // raw value covers checkboxes, dates and numbers.
        $value = $cell['d'] ?? $cell['v'] ?? null;
        if (is_bool($cell['v'] ?? null)) {
            $value = $cell['v'];
        }
        if (is_array($value)) {
            $value = implode(', ', array_map(fn ($v) => is_scalar($v) ? (string) $v : '', $value));
        }

        return is_string($value) ? trim($value) : $value;
    }

    /** @return array<string, mixed> attrs safe to fill() */
    private static function castFields(array $merged): array
    {
        $attrs = [];
        foreach (array_keys(self::FIELDS) as $field) {
            $value = $merged[$field] ?? null;

            if (in_array($field, self::BOOL_FIELDS, true)) {
                $attrs[$field] = $value === true || $value === 'true' || $value === 1;

                continue;
            }
            if (in_array($field, self::DATE_FIELDS, true)) {
                $attrs[$field] = self::parseDate($value);

                continue;
            }
            if ($field === 'number_of_dependents') {
                $attrs[$field] = is_numeric($value) ? (int) $value : null;

                continue;
            }
            $attrs[$field] = is_scalar($value) ? Str::limit((string) $value, 4000, '') : null;
            if ($attrs[$field] === '') {
                $attrs[$field] = null;
            }
        }

        return $attrs;
    }

    private static function parseDate(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || $value === '') {
            return null;
        }
        try {
            $date = CarbonImmutable::parse($value);
            // Guard against junk text Carbon happens to parse and absurd
            // years from typos.
            return ($date->year >= 1900 && $date->year <= 2100) ? $date : null;
        } catch (Throwable) {
            return null;
        }
    }

    // ── Comments ─────────────────────────────────────────────────────

    /**
     * Smartsheet row discussions become portal comments on the application
     * the row feeds — 1,100+ threads of real case history on the master
     * tracker alone.
     */
    private static function importComments(SmartsheetSheet $sheet): void
    {
        $sourceByRow = CbiApplicationSource::query()
            ->where('sheet_remote_id', $sheet->remote_id)
            ->pluck('application_id', 'row_remote_id');

        SmartsheetDiscussion::query()
            ->where('sheet_id', $sheet->id)
            ->where('parent_type', 'ROW')
            ->with('comments')
            ->chunk(100, function ($discussions) use ($sourceByRow) {
                foreach ($discussions as $discussion) {
                    $applicationId = $sourceByRow[$discussion->parent_remote_id] ?? null;
                    if ($applicationId === null) {
                        continue;
                    }
                    foreach ($discussion->comments as $comment) {
                        CbiComment::updateOrCreate(
                            ['smartsheet_comment_remote_id' => $comment->remote_id],
                            [
                                'application_id' => $applicationId,
                                'author_name' => $comment->created_by_name,
                                'author_email' => $comment->created_by_email,
                                'body' => $comment->text,
                                'source' => 'smartsheet',
                                'smartsheet_discussion_remote_id' => $discussion->remote_id,
                                'commented_at' => $comment->created_at_remote,
                            ],
                        );
                    }
                }
            });
    }

    // ── Assessment sheets ────────────────────────────────────────────

    private static function mapAssessmentSheet(SmartsheetSheet $sheet): void
    {
        $titles = self::titleMap($sheet);

        if ($sheet->cbi_application_id === null) {
            self::matchAssessmentSheet($sheet);
        }

        $sheet->rows()->orderBy('row_number')->chunk(500, function ($rows) use ($sheet, $titles) {
            foreach ($rows as $row) {
                $cells = $row->cells ?? [];
                $value = fn (string $title) => self::firstTitleValue($cells, $titles, $title);

                \App\Models\CbiAssessmentItem::updateOrCreate(
                    ['sheet_id' => $sheet->id, 'row_remote_id' => $row->remote_id],
                    [
                        'application_id' => $sheet->cbi_application_id,
                        'parent_row_remote_id' => $row->parent_remote_id,
                        'position' => $row->row_number,
                        'applicant_label' => $value('APPLICANT'),
                        'description' => $value('DESCRIPTION'),
                        'notes' => $value('NOTES'),
                        'agent_assessment' => $value('AGENT ASSESSMENT'),
                        'assessment_response' => $value('ASSESSMENT RESPONSE'),
                        'is_done' => self::firstTitleRaw($cells, $titles, 'STATUS') === true,
                        'row_modified_at' => $row->modified_at_remote,
                    ],
                );
            }
        });

        // Rows deleted remotely disappear from the checklist too.
        \App\Models\CbiAssessmentItem::query()
            ->where('sheet_id', $sheet->id)
            ->whereNotIn('row_remote_id', $sheet->rows()->pluck('remote_id'))
            ->delete();
    }

    /**
     * Assessment sheets are named after their applicant ("GAZI YILDIZ -
     * ASSESSMENT FEEDBACK - …"). An exact normalised-name match links the
     * sheet; anything ambiguous stays unlinked rather than guessing —
     * mis-filing one applicant's assessment under another is the one
     * mistake this module must never make.
     */
    private static function matchAssessmentSheet(SmartsheetSheet $sheet): void
    {
        $name = $sheet->name;
        foreach ([' - ASSESSMENT FEEDBACK', '- ASSESSMENT FEEDBACK', 'ASSESSMENT FEEDBACK', ' - FEEDBACK ASSESSMENT'] as $marker) {
            $pos = stripos($name, $marker);
            if ($pos !== false) {
                $name = substr($name, 0, $pos);
                break;
            }
        }
        $slug = Str::slug(trim($name));
        if ($slug === '') {
            return;
        }

        $matches = CbiApplication::query()
            ->get(['id', 'applicant_name', 'main_applicant_name'])
            ->filter(fn ($a) => Str::slug((string) $a->applicant_name) === $slug
                || Str::slug((string) $a->main_applicant_name) === $slug);

        if ($matches->count() === 1) {
            $sheet->update([
                'cbi_application_id' => $matches->first()->id,
                'match_confidence' => 'exact',
            ]);
        }
    }

    private static function firstTitleValue(array $cells, array $titles, string $title): ?string
    {
        $value = self::firstTitleRaw($cells, $titles, $title);
        if (is_array($value)) {
            $value = implode(', ', array_filter($value, 'is_scalar'));
        }

        return is_scalar($value) ? trim((string) $value) : null;
    }

    private static function firstTitleRaw(array $cells, array $titles, string $title): mixed
    {
        foreach ($titles[$title] ?? [] as $columnId) {
            $cell = $cells[(string) $columnId] ?? null;
            if ($cell !== null) {
                return $cell['v'] ?? $cell['d'] ?? null;
            }
        }

        return null;
    }
}
