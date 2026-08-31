<?php

namespace App\Support\Cip;

use App\Models\CbiApplication;
use App\Models\CbiApplicationEvent;
use App\Models\CbiComment;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipApplicationMessage;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Cbi\AssigneeDirectory;
use App\Support\Cbi\Names;
use App\Support\Imports\ImportPause;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Smartsheet / CBI → native CIP (Phase 11c).
 *
 * One CBI mirror row becomes one cip_applications record: status vocabulary
 * onto {@see Status}, investment options onto {@see InvestmentType}, referral
 * companies onto cip_providers, officer names onto users, comments onto the
 * internal messaging lane, and cbi_application_events onto cip_events. The
 * lifecycle cannot walk a 2018 GRANTED file from NEW, so this writes status
 * directly — the one exception to {@see Engine}. It sends no notices.
 *
 * Idempotent on cip_applications.cbi_application_id. Rows the mirror flagged
 * needs_review are skipped unless asked: a wrong merge of two applicants is
 * worse than a file that waits. Attachment bytes stay in the Cloud-server
 * document importer; this never downloads Smartsheet.
 *
 * @phpstan-type Stats array{
 *     migrated: int,
 *     skippedAlready: int,
 *     skippedNeedsReview: int,
 *     skippedNoProvider: int,
 *     skippedDuplicateNumber: int,
 *     comments: int,
 *     events: int,
 *     paused: bool
 * }
 */
class Cutover
{
    /** Typed into Referred By to mean no firm sent them — same list as the hub importer. */
    private const PRIVATE_MARKERS = ['private', 'private client', 'direct', 'n/a', 'na', 'none'];

    /** @var array<string, CipProvider> normalised company/provider name => provider */
    private array $providers = [];

    private ?CipProvider $private = null;

    private ?AssigneeDirectory $assignees = null;

    /** @var array<int, true> cip_number values taken this run */
    private array $takenCipNumbers = [];

    /** @var array<string, true> internal_number values taken this run */
    private array $takenInternalNumbers = [];

    /** @var array<int, true> CBI ids already on a CIP row */
    private array $already = [];

    /** @var Stats */
    public array $stats = [
        'migrated' => 0,
        'skippedAlready' => 0,
        'skippedNeedsReview' => 0,
        'skippedNoProvider' => 0,
        'skippedDuplicateNumber' => 0,
        'comments' => 0,
        'events' => 0,
        'paused' => false,
    ];

    public function __construct(
        private bool $dryRun = false,
        private bool $includeNeedsReview = false,
    ) {}

    /**
     * @param  callable():void|null  $onProgress
     * @return Stats
     */
    public function run(?int $limit = null, ?callable $onProgress = null): array
    {
        $this->loadProviders();
        $this->assignees = AssigneeDirectory::build();
        $this->indexTakenNumbers();
        CipApplication::query()
            ->whereNotNull('cbi_application_id')
            ->pluck('cbi_application_id')
            ->each(function ($id) {
                $this->already[(int) $id] = true;
            });

        $query = CbiApplication::query()->orderBy('id');
        $migrated = 0;

        $query->chunkById(50, function ($rows) use ($limit, $onProgress, &$migrated) {
            foreach ($rows as $row) {
                if ($limit !== null && $migrated >= $limit) {
                    return false;
                }

                $did = $this->one($row);
                if ($did) {
                    $migrated++;
                }
                if ($onProgress) {
                    $onProgress();
                }
            }

            return true;
        });

        $this->stats['migrated'] = $migrated;

        return $this->stats;
    }

    public function pauseSmartsheet(?int $userId = null): void
    {
        if ($this->dryRun) {
            return;
        }

        ImportPause::putTarget(ImportPause::TARGET_SMARTSHEET, true, $userId);
        $this->stats['paused'] = true;
    }

    private function one(CbiApplication $row): bool
    {
        if (isset($this->already[$row->id])) {
            $this->stats['skippedAlready']++;

            return false;
        }

        if ($row->needs_review && ! $this->includeNeedsReview) {
            $this->stats['skippedNeedsReview']++;

            return false;
        }

        $provider = $this->providerFor($row);
        if ($provider === null) {
            $this->stats['skippedNoProvider']++;

            return false;
        }

        $numbers = $this->numbersFor($row, $provider);
        if ($numbers === null) {
            $this->stats['skippedDuplicateNumber']++;

            return false;
        }

        if ($this->dryRun) {
            $this->rememberNumbers($numbers);
            $this->stats['comments'] += $row->comments()->count();
            $this->stats['events'] += $row->events()
                ->whereNotIn('type', [CbiApplicationEvent::TYPE_IMPORTED, CbiApplicationEvent::TYPE_COMMENT_ADDED])
                ->count();

            return true;
        }

        DB::transaction(function () use ($row, $provider, $numbers) {
            if ($numbers['adoptInternal']) {
                Numbering::reserve($provider, $numbers['internal']);
            } else {
                $when = $row->received_at ?? $row->submitted_at ?? $row->first_imported_at;
                $numbers['internal'] = Numbering::next(
                    $provider,
                    $when instanceof CarbonInterface ? $when : null,
                );
            }

            $status = self::statusOf($row);
            $investment = self::investmentOf($row);
            $officer = $this->officerFor($row);

            $application = new CipApplication;
            $application->forceFill([
                'provider_id' => $provider->id,
                'client_id' => $row->client_id,
                'cbi_application_id' => $row->id,
                'investment_type' => $investment['type'],
                'investment_type_other' => $investment['other'],
                'unit_contact' => self::unitContact($row),
                'internal_number' => $numbers['internal'],
                'cip_number' => $numbers['cip'],
                'status' => $status,
                'phase' => Status::inLane($status) ? Phase::POST_APPROVAL : Phase::PRE_APPROVAL,
                'assigned_officer_id' => $officer?->id,
                'submitted_at' => $row->submitted_at ?? $row->received_at,
                'accepted_at' => $row->accepted_at,
                'decided_at' => $row->decision_received_at,
                'decision' => self::decisionOf($row, $status),
                'cor_submitted_at' => $row->cor_submitted_at,
                'cor_received_at' => $row->cor_received_at,
                'nic_submitted_at' => $row->nic_request_sent_at,
                'nic_received_at' => $row->nic_letter_received_at,
                'passport_submitted_at' => $row->passport_submitted_at,
                'passport_received_at' => $row->passport_received_at,
                'passport_delivered_at' => $row->originals_delivered_at ?? $row->final_documents_sent_at,
                'post_approval_at' => Status::inLane($status)
                    ? ($row->cor_submitted_at ?? $row->decision_received_at ?? now())
                    : null,
            ])->save();

            $this->rememberNumbers($numbers);
            $this->already[$row->id] = true;
            $this->personFor($application, $row);
            $application->load(['people', 'provider', 'client']);
            Tree::client($application);
            $this->stampClient($application);
            $this->assign($application, $officer);
            $this->messages($application, $row);
            $this->events($application, $row, $status);
        });

        return true;
    }

    /**
     * Status the lifecycle would have reached, read off flags and dates
     * before the Smartsheet label — a granted file still sitting on
     * "BACKGROUND CHECK" in the sheet is granted.
     */
    public static function statusOf(CbiApplication $row): string
    {
        $label = self::normaliseLabel((string) $row->status);

        if (self::isDenied($label)) {
            return Status::DENIED;
        }

        $post = self::postApprovalOf($row, $label);
        if ($post !== null) {
            return $post;
        }

        if ($row->granted || $label === 'GRANTED' || $label === 'APPROVED') {
            return Status::GRANTED;
        }

        if ($row->closed || in_array($label, ['CLOSED', 'WITHDRAWN', 'RESCINDED'], true)) {
            return Status::CLOSED;
        }

        return self::preApprovalOf($row, $label);
    }

    /**
     * @return array{type: ?string, other: ?string}
     */
    public static function investmentOf(CbiApplication $row): array
    {
        $raw = trim((string) $row->investment_option);
        if ($raw === '') {
            return ['type' => null, 'other' => null];
        }

        $key = Names::normalise($raw);

        foreach ([
            InvestmentType::REAL_ESTATE => ['real estate', 'real-estate', 're project'],
            InvestmentType::NATIONAL_ACTION_BONDS => ['national action bond', 'nab', 'action bond'],
            InvestmentType::NATIONAL_ECONOMIC_FUND => ['national economic fund', 'nef', 'donation'],
            InvestmentType::ENTERPRISE_PROJECT => ['enterprise'],
        ] as $type => $needles) {
            foreach ($needles as $needle) {
                if (str_contains($key, $needle)) {
                    return ['type' => $type, 'other' => null];
                }
            }
        }

        if (str_contains($key, 'bond')) {
            return ['type' => InvestmentType::NATIONAL_ACTION_BONDS, 'other' => null];
        }

        return ['type' => InvestmentType::OTHER, 'other' => Str::limit($raw, 191, '')];
    }

    private static function isDenied(string $label): bool
    {
        return $label === 'DENIED';
    }

    private static function postApprovalOf(CbiApplication $row, string $label): ?string
    {
        $hasPost = $row->cor_submitted_at
            || $row->cor_received_at
            || $row->nic_request_sent_at
            || $row->nic_letter_received_at
            || $row->passport_pads_received_at
            || $row->ready_for_passport_submission_at
            || $row->passport_submitted_at
            || $row->passport_received_at
            || $row->originals_delivered_at
            || $row->final_documents_sent_at
            || $row->stage === CbiApplication::STAGE_TRACKER
            || str_contains($label, 'COR')
            || str_contains($label, 'PASSPORT')
            || str_contains($label, 'NIC');

        if (! $hasPost && ! ($row->granted && $row->closed)) {
            return null;
        }

        if ($row->originals_delivered_at || $row->final_documents_sent_at
            || ($row->closed && ($row->granted || $row->passport_received_at))) {
            return Status::CLOSED;
        }
        if ($row->passport_received_at) {
            return Status::READY_FOR_DELIVERY;
        }
        if ($row->passport_submitted_at) {
            return Status::PENDING_PASSPORT;
        }
        if ($row->ready_for_passport_submission_at || $row->nic_letter_received_at) {
            return Status::APPLY_FOR_PASSPORT;
        }
        if ($row->nic_request_sent_at) {
            return Status::PENDING_NIC;
        }
        if ($row->cor_received_at) {
            return Status::APPLY_FOR_NIC;
        }
        if ($row->cor_submitted_at) {
            return Status::PENDING_COR;
        }

        return Status::POST_APPROVAL;
    }

    private static function preApprovalOf(CbiApplication $row, string $label): string
    {
        $mapped = match (true) {
            $label === 'NEW', $label === 'DRAFT', $label === '' => Status::NEW,
            str_contains($label, 'APPLICATION REVIEW') => Status::REVIEW_APPLICATION,
            str_contains($label, 'ASSESSMENT FEEDBACK') => Status::ASSESSMENT_FEEDBACK,
            str_contains($label, 'ADDITIONAL INFORMATION'),
            str_contains($label, 'UPDATE') => Status::UPDATE_REQUIRED,
            str_contains($label, 'TO SUBMIT'),
            str_contains($label, 'PRE PROCESSING') => Status::READY_TO_SUBMIT,
            str_contains($label, 'NON-COMPLIANT'),
            str_contains($label, 'NON COMPLIANT'),
            str_contains($label, 'QUERIES') => Status::NON_COMPLIANT,
            str_contains($label, 'PENDING REVIEW') => Status::PENDING_REVIEW,
            str_contains($label, 'DELAYED') => Status::DELAYED,
            str_contains($label, 'BACKGROUND') => Status::BACKGROUND_CHECK,
            str_contains($label, 'ASSESSED') => Status::BACKGROUND_CHECK,
            default => null,
        };

        if ($mapped !== null) {
            return $mapped;
        }

        if ($row->accepted_at) {
            return Status::BACKGROUND_CHECK;
        }
        if ($row->submitted_at) {
            return Status::PENDING_REVIEW;
        }

        return Status::NEW;
    }

    private static function decisionOf(CbiApplication $row, string $status): ?string
    {
        if ($status === Status::DENIED) {
            return CipApplication::DECISION_DENIED;
        }
        if ($status === Status::GRANTED || Status::inLane($status)) {
            return CipApplication::DECISION_GRANTED;
        }
        if ($row->granted) {
            return CipApplication::DECISION_GRANTED;
        }

        return null;
    }

    private static function unitContact(CbiApplication $row): ?string
    {
        foreach ([$row->verification_officer, $row->file_owner, $row->main_contact] as $value) {
            $value = Names::tidy((string) $value);
            if ($value !== '' && ! Names::isEmptyMarker($value)) {
                return Str::limit($value, 191, '');
            }
        }

        return null;
    }

    private static function statusFromLabel(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $row = new CbiApplication;
        $row->status = $value;
        $row->granted = false;
        $row->closed = false;
        $row->stage = CbiApplication::STAGE_APPLICATIONS;

        return self::statusOf($row);
    }

    private static function normaliseLabel(string $status): string
    {
        $status = strtoupper(trim($status));
        $status = str_replace(['_'], ' ', $status);

        return preg_replace('/\s+/', ' ', $status) ?? $status;
    }

    /**
     * @return array{internal: string, cip: ?string, adoptInternal: bool}|null
     */
    private function numbersFor(CbiApplication $row, CipProvider $provider): ?array
    {
        $raw = trim((string) $row->applicant_number);

        if ($raw !== '' && Numbering::matches($provider, $raw)) {
            if ($this->internalTaken($raw)) {
                return null;
            }

            return ['internal' => strtoupper($raw), 'cip' => null, 'adoptInternal' => true];
        }

        $cip = $raw !== '' ? Str::limit($raw, 32, '') : null;
        if ($cip !== null && $this->cipTaken($cip)) {
            return null;
        }

        return ['internal' => '', 'cip' => $cip, 'adoptInternal' => false];
    }

    /** @param array{internal: string, cip: ?string, adoptInternal: bool} $numbers */
    private function rememberNumbers(array $numbers): void
    {
        if ($numbers['internal'] !== '') {
            $this->takenInternalNumbers[strtoupper($numbers['internal'])] = true;
        }
        if ($numbers['cip'] !== null && $numbers['cip'] !== '') {
            $this->takenCipNumbers[$numbers['cip']] = true;
        }
    }

    private function internalTaken(string $number): bool
    {
        $number = strtoupper($number);

        return isset($this->takenInternalNumbers[$number])
            || CipApplication::where('internal_number', $number)->exists();
    }

    private function cipTaken(string $number): bool
    {
        return isset($this->takenCipNumbers[$number])
            || CipApplication::where('cip_number', $number)->exists();
    }

    private function indexTakenNumbers(): void
    {
        CipApplication::query()
            ->whereNotNull('internal_number')
            ->pluck('internal_number')
            ->each(function ($number) {
                $this->takenInternalNumbers[strtoupper((string) $number)] = true;
            });

        CipApplication::query()
            ->whereNotNull('cip_number')
            ->pluck('cip_number')
            ->each(function ($number) {
                $this->takenCipNumbers[(string) $number] = true;
            });
    }

    private function loadProviders(): void
    {
        $this->private = CipProvider::query()
            ->where('code', CipProvider::PRIVATE_CLIENT_CODE)
            ->first();

        foreach (CipProvider::query()->with('company')->get() as $provider) {
            $this->providers[Names::normalise($provider->name)] = $provider;
            if ($provider->company) {
                $this->providers[Names::normalise($provider->company->name)] = $provider;
            }
        }

        // Companies that carry a CIP code but whose provider name drifted.
        foreach (Company::query()->whereIn('id', CipProvider::query()->whereNotNull('company_id')->select('company_id'))->get() as $company) {
            $provider = CipProvider::where('company_id', $company->id)->first();
            if ($provider) {
                $this->providers[Names::normalise($company->name)] = $provider;
            }
        }
    }

    private function providerFor(CbiApplication $row): ?CipProvider
    {
        foreach ([$row->referred_by, $row->service_provider] as $raw) {
            $raw = (string) $raw;
            if (Names::isEmptyMarker($raw)) {
                continue;
            }
            $key = Names::normalise($raw);
            if ($key === '') {
                continue;
            }
            if (in_array($key, self::PRIVATE_MARKERS, true)) {
                return $this->private;
            }
            if (isset($this->providers[$key])) {
                return $this->providers[$key];
            }
        }

        $referred = Names::normalise((string) $row->referred_by);
        if ($referred === '' || in_array($referred, self::PRIVATE_MARKERS, true)) {
            return $this->private;
        }

        return null;
    }

    private function officerFor(CbiApplication $row): ?User
    {
        if ($row->assigned_user_id) {
            return User::find($row->assigned_user_id);
        }

        $hit = $this->assignees?->resolve($row->assigned_to);

        return $hit['user'] ?? null;
    }

    private function personFor(CipApplication $application, CbiApplication $row): void
    {
        $name = Names::tidy((string) ($row->main_applicant_name ?: $row->applicant_name));
        if ($name === '' || Names::isEmptyMarker($name)) {
            $name = $application->displayNumber() !== ''
                ? $application->displayNumber()
                : 'Unknown applicant';
        }

        $parts = preg_split('/\s+/', $name) ?: [$name];

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $parts[0] ?? $name,
            'last_name' => count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : '',
            'date_of_birth' => $row->date_of_birth,
            'country_of_residence' => $row->nationality,
        ]);
    }

    private function stampClient(CipApplication $application): void
    {
        $client = $application->client;
        if (! $client) {
            return;
        }

        $data = is_array($client->data) ? $client->data : [];
        $data['cip'] = ['applicationUuid' => $application->uuid];
        $client->forceFill(['data' => $data])->save();
    }

    private function assign(CipApplication $application, ?User $officer): void
    {
        if ($officer === null) {
            return;
        }

        CipApplicationAssignment::create([
            'application_id' => $application->id,
            'user_id' => $officer->id,
            'role' => CipAccess::REVIEWING_OFFICER,
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
            'starts_at' => now(),
        ]);
    }

    private function messages(CipApplication $application, CbiApplication $row): void
    {
        $notes = trim((string) $row->notes);
        if ($notes !== '') {
            $this->writeMessage($application, 'Caseload notes', $notes, $row->synced_at ?? $row->first_imported_at);
        }

        $comments = CbiComment::query()
            ->where('application_id', $row->id)
            ->orderBy('id')
            ->get();

        foreach ($comments as $comment) {
            $body = trim((string) $comment->body);
            if ($body === '') {
                continue;
            }
            $this->writeMessage(
                $application,
                $comment->author_name ?: 'Smartsheet',
                $body,
                $comment->commented_at ?? $comment->created_at,
                $comment->user_id,
            );
        }
    }

    private function writeMessage(
        CipApplication $application,
        string $authorName,
        string $body,
        mixed $when,
        ?int $authorId = null,
    ): void {
        $message = new CipApplicationMessage;
        $message->forceFill([
            'application_id' => $application->id,
            'author_id' => $authorId,
            'author_name' => Str::limit($authorName !== '' ? $authorName : 'Smartsheet', 191, ''),
            'lane' => CipApplicationMessage::LANE_INTERNAL,
            'body' => $body,
        ]);
        if ($when) {
            $message->created_at = $when;
            $message->updated_at = $when;
        }
        $message->save();
        $this->stats['comments']++;
    }

    private function events(CipApplication $application, CbiApplication $row, string $status): void
    {
        $legacy = CbiApplicationEvent::query()
            ->where('application_id', $row->id)
            ->whereNotIn('type', [CbiApplicationEvent::TYPE_IMPORTED, CbiApplicationEvent::TYPE_COMMENT_ADDED])
            ->orderBy('id')
            ->get();

        foreach ($legacy as $event) {
            $action = match ($event->type) {
                CbiApplicationEvent::TYPE_STATUS_CHANGED,
                CbiApplicationEvent::TYPE_STAGE_CHANGED => CipEvent::ACTION_STATUS_CHANGED,
                CbiApplicationEvent::TYPE_ASSIGNED => CipEvent::ACTION_ASSIGNED,
                default => CipEvent::ACTION_IMPORTED,
            };

            $to = $action === CipEvent::ACTION_STATUS_CHANGED
                ? self::statusFromLabel($event->to_value)
                : null;
            $from = $action === CipEvent::ACTION_STATUS_CHANGED
                ? self::statusFromLabel($event->from_value)
                : null;

            $this->writeEvent($application, $action, [
                'legacyType' => $event->type,
                'field' => $event->field,
                'officer' => $action === CipEvent::ACTION_ASSIGNED
                    ? ($event->actor_name ?: $event->to_value)
                    : null,
            ], $from, $to, $event->actor_user_id, $event->actor_name, $event->occurred_at ?? $event->created_at);
        }

        $when = $row->first_imported_at ?? $row->synced_at;
        $this->writeEvent(
            $application,
            CipEvent::ACTION_IMPORTED,
            [
                'cbiApplicationId' => $row->id,
                'applicantNumber' => $row->applicant_number,
                'legacyStatus' => $row->status,
            ],
            null,
            $status,
            null,
            null,
            $when,
        );
    }

    private function writeEvent(
        CipApplication $application,
        string $action,
        array $meta,
        ?string $from,
        ?string $to,
        ?int $actorId,
        ?string $actorName,
        mixed $when,
    ): void {
        $meta = array_filter($meta, fn ($v) => $v !== null && $v !== '');

        $event = new CipEvent;
        $event->forceFill([
            'application_id' => $application->id,
            'actor_id' => $actorId,
            'actor_name' => $actorName !== null && $actorName !== '' ? $actorName : null,
            'action' => $action,
            'from_status' => $from,
            'to_status' => $to,
            'meta' => $meta === [] ? null : $meta,
        ]);
        if ($when) {
            $event->created_at = $when;
        }
        $event->save();
        $this->stats['events']++;
    }
}
