<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Post-approval family additions: one spouse or dependent filed against a
 * granted parent application, one profile at a time.
 *
 * The parent is named by the Unit's CIP number and the Certificate of
 * Registration number, not by picking a row from a list. Both have to match
 * the same file, and that file has to be a grant — an Add-On is not a way
 * to start a new citizenship file.
 */
class AddOn
{
    public const TYPE_SPOUSE = ApplicantType::SPOUSE;

    public const TYPE_DEPENDENT_UNDER_16 = ApplicantType::DEPENDENT_UNDER_16;

    public const TYPE_DEPENDENT_16_OVER = ApplicantType::DEPENDENT_16_OVER;

    public const TYPES = [
        self::TYPE_SPOUSE,
        self::TYPE_DEPENDENT_UNDER_16,
        self::TYPE_DEPENDENT_16_OVER,
    ];

    public const RELATIONSHIP_SON = 'son';

    public const RELATIONSHIP_DAUGHTER = 'daughter';

    public const RELATIONSHIP_OTHER = 'other_qualified_dependent';

    public const DEPENDENT_RELATIONSHIPS = [
        self::RELATIONSHIP_SON,
        self::RELATIONSHIP_DAUGHTER,
        self::RELATIONSHIP_OTHER,
    ];

    /**
     * An Add-On still in flight. Finished outcomes (granted, denied, closed)
     * free the parent to take another profile.
     *
     * @var list<string>
     */
    public const OPEN_STATUSES_EXCLUDED = [
        Status::GRANTED,
        Status::DENIED,
        Status::POST_APPROVED,
        Status::POST_DENIED,
        Status::CLOSED,
    ];

    /** @return array<string, string> */
    public static function typeOptions(): array
    {
        $cutoff = ApplicantType::cutoff();

        return [
            self::TYPE_SPOUSE => 'Spouse',
            self::TYPE_DEPENDENT_UNDER_16 => 'Dependent Under '.$cutoff,
            self::TYPE_DEPENDENT_16_OVER => 'Dependent '.$cutoff.' and Over',
        ];
    }

    public static function typeLabel(?string $type): string
    {
        if ($type === null || $type === '') {
            return '';
        }

        return self::typeOptions()[$type] ?? $type;
    }

    public static function isValidType(string $type): bool
    {
        return in_array($type, self::TYPES, true);
    }

    /** @return array<string, string> */
    public static function relationshipOptions(?string $type = null): array
    {
        if ($type === self::TYPE_SPOUSE) {
            return [CipPerson::RELATIONSHIP_SPOUSE => 'Spouse'];
        }

        if (in_array($type, [self::TYPE_DEPENDENT_UNDER_16, self::TYPE_DEPENDENT_16_OVER], true)) {
            return [
                self::RELATIONSHIP_SON => 'Son',
                self::RELATIONSHIP_DAUGHTER => 'Daughter',
                self::RELATIONSHIP_OTHER => 'Other Qualified Dependent',
            ];
        }

        return [
            CipPerson::RELATIONSHIP_SPOUSE => 'Spouse',
            self::RELATIONSHIP_SON => 'Son',
            self::RELATIONSHIP_DAUGHTER => 'Daughter',
            self::RELATIONSHIP_OTHER => 'Other Qualified Dependent',
        ];
    }

    public static function relationshipLabel(?string $relationship): string
    {
        return match ($relationship) {
            CipPerson::RELATIONSHIP_SPOUSE => 'Spouse',
            self::RELATIONSHIP_SON => 'Son',
            self::RELATIONSHIP_DAUGHTER => 'Daughter',
            self::RELATIONSHIP_OTHER => 'Other Qualified Dependent',
            CipPerson::RELATIONSHIP_QUALIFIED => 'Qualified Dependent',
            default => $relationship ?? '',
        };
    }

    public static function relationshipsFor(string $type): array
    {
        return array_keys(self::relationshipOptions($type));
    }

    public static function normalizeNumber(?string $value): string
    {
        // Spaces and hyphens are noise on a Unit identifier: letters and
        // digits are what the letter and the row have to share.
        return mb_strtolower(preg_replace('/[\s\-]+/u', '', (string) $value) ?? '');
    }

    /** SQL expression that matches {@see normalizeNumber} for a column. */
    public static function numberMatchSql(string $column): string
    {
        return 'LOWER(REPLACE(REPLACE(COALESCE('.$column.", ''), ' ', ''), '-', ''))";
    }

    public static function normalizeName(?string $value): string
    {
        return mb_strtolower(preg_replace('/\s+/u', ' ', trim((string) $value)) ?? '');
    }

    public static function namesMatch(?string $typed, ?string $actual): bool
    {
        $left = self::normalizeName($typed);
        $right = self::normalizeName($actual);

        return $left !== '' && $left === $right;
    }

    /**
     * Whether the typed main-applicant name is the person on this parent.
     * Null means it is; a string is the reason it is not.
     */
    public static function nameMismatch(CipApplication $parent, ?string $typed): ?string
    {
        if (trim((string) $typed) === '') {
            return 'Enter the main applicant name.';
        }

        $expected = (string) (self::parentPayload($parent)['applicantName'] ?? '');
        if (! self::namesMatch($typed, $expected)) {
            return 'Main applicant name does not match this CIP application.';
        }

        return null;
    }

    /**
     * Look up a parent by CIP number and COR number within this reader's slice.
     *
     * @return array{
     *     ok: bool,
     *     error?: string,
     *     field?: string,
     *     parent?: array<string, mixed>,
     *     openAddOn?: array{id: string, number: string, statusLabel: string}|null
     * }
     */
    public static function lookup(?User $user, string $cipNumber, string $corNumber): array
    {
        $cip = trim($cipNumber);
        $cor = trim($corNumber);

        if ($cip === '') {
            return ['ok' => false, 'error' => 'Enter the CIP application number.', 'field' => 'parentCipNumber'];
        }

        if ($cor === '') {
            return ['ok' => false, 'error' => 'Enter the Certificate of Registration number.', 'field' => 'parentCorNumber'];
        }

        $match = self::findByCipNumber($user, $cip);

        if ($match === null) {
            return ['ok' => false, 'error' => 'CIP application number not found.', 'field' => 'parentCipNumber'];
        }

        if ($match->phase === Phase::ADD_ON) {
            return ['ok' => false, 'error' => 'An Add-On application cannot be filed against another Add-On.', 'field' => 'parentCipNumber'];
        }

        if (! self::isEligibleParent($match)) {
            return ['ok' => false, 'error' => 'The parent application must be granted.', 'field' => 'parentCipNumber'];
        }

        /*
         * Most post-approval files never had COR staged in the portal. The
         * certificate is still what the reader has, so an empty parent COR
         * accepts the typed number; a stored one must match it.
         */
        if (filled($match->cor_number)
            && self::normalizeNumber((string) $match->cor_number) !== self::normalizeNumber($cor)) {
            return ['ok' => false, 'error' => 'COR number does not match this CIP application.', 'field' => 'parentCorNumber'];
        }

        $open = self::openAddOn($match);

        $payload = self::parentPayload($match);
        if (! filled($payload['corNumber'] ?? null)) {
            $payload['corNumber'] = $cor;
        }

        return [
            'ok' => true,
            'parent' => $payload,
            'openAddOn' => $open ? [
                'id' => $open->uuid,
                'number' => $open->displayNumber(),
                'statusLabel' => Status::label($open->status),
            ] : null,
        ];
    }

    /**
     * The parent row this filing names, or null when the pair does not resolve.
     */
    public static function findParent(?User $user, string $cipNumber, string $corNumber): ?CipApplication
    {
        $result = self::lookup($user, $cipNumber, $corNumber);

        if (! ($result['ok'] ?? false) || empty($result['parent']['id'])) {
            return null;
        }

        return ApplicationScope::query($user)
            ->where('uuid', $result['parent']['id'])
            ->first();
    }

    /**
     * Typeahead for the Add-On CIP number field: granted parents whose CIP
     * number (or main applicant name) contains what has been typed so far.
     *
     * @return list<array<string, mixed>>
     */
    public static function suggest(?User $user, string $term, int $limit = 8): array
    {
        $needle = trim($term);
        if (mb_strlen($needle) < 2) {
            return [];
        }

        $like = '%'.mb_strtolower($needle).'%';
        $numberNeedle = self::normalizeNumber($needle);

        $rows = self::eligibleParentQuery($user)
            ->with([
                'provider:id,uuid,name,code',
                'client:id,name,photo_url,user_id',
                'client.user:id,avatar_url,provider_avatar_url',
                'people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
            ])
            ->where(function ($q) use ($like, $numberNeedle) {
                $q->whereRaw(
                    'LOWER(COALESCE(cip_applications.cip_number, \'\')) like ?',
                    [$like],
                );
                if ($numberNeedle !== '') {
                    $q->orWhereRaw(
                        self::numberMatchSql('cip_applications.cip_number').' like ?',
                        ['%'.$numberNeedle.'%'],
                    );
                }
                $q->orWhereHas('people', function ($people) use ($like) {
                    $nameSql = DB::connection()->getDriverName() === 'mysql'
                        ? "LOWER(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))))"
                        : "LOWER(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')))";
                    $people->where('role', CipPerson::ROLE_MAIN_APPLICANT)
                        ->where(function ($name) use ($like, $nameSql) {
                            $name->whereRaw('LOWER(COALESCE(first_name, \'\')) like ?', [$like])
                                ->orWhereRaw('LOWER(COALESCE(last_name, \'\')) like ?', [$like])
                                ->orWhereRaw($nameSql.' like ?', [$like]);
                        });
                });
            })
            ->orderByDesc('cip_applications.id')
            ->limit(max(1, min($limit, 20)))
            ->get();

        return $rows
            ->filter(fn (CipApplication $row) => self::isEligibleParent($row))
            ->values()
            ->map(fn (CipApplication $row) => self::parentPayload($row))
            ->all();
    }

    /**
     * One application by CIP number inside this reader's slice, or null.
     */
    public static function findByCipNumber(?User $user, string $cipNumber): ?CipApplication
    {
        $cip = trim($cipNumber);
        if ($cip === '') {
            return null;
        }

        return ApplicationScope::query($user)
            ->whereRaw(
                self::numberMatchSql('cip_applications.cip_number').' = ?',
                [self::normalizeNumber($cip)],
            )
            ->with([
                'provider:id,uuid,name,code',
                'client:id,name,photo_url,user_id',
                'client.user:id,avatar_url,provider_avatar_url',
                'people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
            ])
            ->first();
    }

    /**
     * Granted parents that can take an Add-On, already narrowed to the
     * reader's slice. COR is not required here: many post-approval files
     * never had it staged, and the typeahead still has to name them.
     */
    public static function eligibleParentQuery(?User $user): Builder
    {
        return ApplicationScope::query($user)
            ->whereNotNull('cip_applications.cip_number')
            ->where('cip_applications.cip_number', '!=', '')
            ->where(function ($q) {
                $q->whereNull('cip_applications.phase')
                    ->orWhere('cip_applications.phase', '!=', Phase::ADD_ON);
            })
            ->where(function ($q) {
                $q->where('cip_applications.status', Status::GRANTED)
                    ->orWhere('cip_applications.status', Status::POST_APPROVED)
                    ->orWhere('cip_applications.decision', CipApplication::DECISION_GRANTED)
                    ->orWhere('cip_applications.decision', Status::POST_APPROVED)
                    ->orWhere(function ($post) {
                        $post->where('cip_applications.phase', Phase::POST_APPROVAL)
                            ->where('cip_applications.status', '!=', Status::POST_DENIED);
                    });
            });
    }

    public static function isEligibleParent(CipApplication $application): bool
    {
        if (($application->phase ?? '') === Phase::ADD_ON) {
            return false;
        }

        if (in_array($application->status, [Status::DENIED, Status::POST_DENIED], true)) {
            return false;
        }

        if (! filled($application->cip_number)) {
            return false;
        }

        if ($application->status === Status::GRANTED
            || $application->status === Status::POST_APPROVED
            || $application->decision === CipApplication::DECISION_GRANTED
            || $application->decision === Status::POST_APPROVED) {
            return true;
        }

        return ($application->phase ?? '') === Phase::POST_APPROVAL
            && $application->status !== Status::POST_DENIED;
    }

    public static function hasOpenAddOn(CipApplication $parent, ?int $ignoreId = null): bool
    {
        $query = $parent->addOns()
            ->whereNotIn('status', self::OPEN_STATUSES_EXCLUDED);

        if ($ignoreId) {
            $query->where('id', '!=', $ignoreId);
        }

        return $query->exists();
    }

    public static function openAddOn(CipApplication $parent): ?CipApplication
    {
        return $parent->addOns()
            ->whereNotIn('status', self::OPEN_STATUSES_EXCLUDED)
            ->latest('id')
            ->first();
    }

    /**
     * Whether this Add-On type, date of birth and relationship can be filed
     * together. Null means they can; a string is the reason they cannot.
     */
    public static function typeMismatch(?string $type, ?string $dateOfBirth, ?string $relationship): ?string
    {
        if ($type === null || $type === '' || ! self::isValidType($type)) {
            return null;
        }

        if ($type === self::TYPE_SPOUSE) {
            if ($relationship && $relationship !== CipPerson::RELATIONSHIP_SPOUSE) {
                return 'A spouse Add-On must use the Spouse relationship.';
            }

            return null;
        }

        if ($relationship === CipPerson::RELATIONSHIP_SPOUSE) {
            return 'A dependent Add-On cannot be filed as a spouse.';
        }

        if (! $dateOfBirth) {
            return null;
        }

        try {
            $birth = Carbon::parse($dateOfBirth);
        } catch (\Throwable) {
            return null;
        }

        $under = $birth->copy()->addYears(ApplicantType::cutoff())->isAfter(now());
        $cutoff = ApplicantType::cutoff();

        if ($type === self::TYPE_DEPENDENT_UNDER_16 && ! $under) {
            return 'This date of birth is '.$cutoff.' or over. Choose Dependent '.$cutoff.' and over.';
        }

        if ($type === self::TYPE_DEPENDENT_16_OVER && $under) {
            return 'This date of birth is under '.$cutoff.'. Choose Dependent under '.$cutoff.'.';
        }

        return null;
    }

    /**
     * What the application record carries for an Add-On file (and empty
     * placeholders on every other phase, so the client does not have to ask
     * whether the keys exist).
     *
     * @return array{addonType:?string, addonTypeLabel:?string, parent:?array<string, mixed>}
     */
    public static function payload(CipApplication $application): array
    {
        if (($application->phase ?? '') !== Phase::ADD_ON) {
            return [
                'addonType' => null,
                'addonTypeLabel' => null,
                'parent' => null,
            ];
        }

        $parent = $application->relationLoaded('parent')
            ? $application->parent
            : $application->parent()
                ->with([
                    'provider:id,uuid,name,code',
                    'client:id,name',
                    'people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
                ])
                ->first();

        return [
            'addonType' => $application->addon_type,
            'addonTypeLabel' => self::typeLabel($application->addon_type),
            'parent' => $parent ? self::parentPayload($parent) : null,
        ];
    }

    /** @return array<string, mixed> */
    public static function parentPayload(CipApplication $parent): array
    {
        $main = $parent->relationLoaded('people')
            ? $parent->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)
            : $parent->people()->where('role', CipPerson::ROLE_MAIN_APPLICANT)->first();

        $name = $main?->fullName() ?: (string) ($parent->client?->name ?? '');

        return [
            'id' => $parent->uuid,
            'cipNumber' => $parent->cip_number,
            'corNumber' => $parent->cor_number,
            'number' => $parent->displayNumber(),
            'applicantName' => CipPerson::upperName($name) ?: $name,
            'photo' => self::parentPhoto($main, $parent),
            'status' => $parent->status,
            'statusLabel' => Status::label($parent->status),
            'providerId' => $parent->provider?->uuid,
            'providerName' => $parent->provider?->name,
            'investmentType' => $parent->investment_type,
        ];
    }

    /**
     * The main applicant's face for typeahead and confirm rows.
     *
     * Same priority as the CIP worklist: passport likeness on the person,
     * then the hub client's photo, then a live portal login avatar.
     */
    private static function parentPhoto(?CipPerson $main, CipApplication $parent): ?string
    {
        if ($main?->photo_url) {
            return $main->photo_url;
        }

        if ($main?->photo_path) {
            return '/portal/cip/people/'.$main->uuid.'/passport-photo?v='
                .substr(md5($main->photo_path.'|'.($main->updated_at?->getTimestamp() ?? 0)), 0, 8);
        }

        $client = $parent->client;
        if ($client?->photo_url) {
            return $client->photo_url;
        }

        if ($client && $client->hasLiveLogin()) {
            return $client->user?->photoUrl();
        }

        return null;
    }

    public static function personLabel(CipPerson $person): string
    {
        $named = self::relationshipLabel($person->relationship);
        if ($named !== '') {
            return $named;
        }

        $type = $person->application?->addon_type;

        return $type ? self::typeLabel($type) : 'Add-On Applicant';
    }
}
