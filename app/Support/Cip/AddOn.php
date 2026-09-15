<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\User;
use Illuminate\Support\Carbon;

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
            self::TYPE_DEPENDENT_UNDER_16 => 'Dependent under '.$cutoff,
            self::TYPE_DEPENDENT_16_OVER => 'Dependent '.$cutoff.' and over',
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

        return [
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
        return mb_strtolower(preg_replace('/\s+/u', '', (string) $value) ?? '');
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

        $match = ApplicationScope::query($user)
            ->whereRaw(
                'LOWER(REPLACE(COALESCE(cip_applications.cip_number, \'\'), \' \', \'\')) = ?',
                [self::normalizeNumber($cip)],
            )
            ->with([
                'provider:id,uuid,name,code',
                'client:id,name',
                'people' => fn ($q) => $q->where('role', CipPerson::ROLE_MAIN_APPLICANT),
            ])
            ->first();

        if ($match === null) {
            return ['ok' => false, 'error' => 'CIP application number not found.', 'field' => 'parentCipNumber'];
        }

        if ($match->phase === Phase::ADD_ON) {
            return ['ok' => false, 'error' => 'An Add-On application cannot be filed against another Add-On.', 'field' => 'parentCipNumber'];
        }

        if (! filled($match->cor_number)) {
            return [
                'ok' => false,
                'error' => 'This application does not have a Certificate of Registration number on file.',
                'field' => 'parentCorNumber',
            ];
        }

        if (self::normalizeNumber((string) $match->cor_number) !== self::normalizeNumber($cor)) {
            return ['ok' => false, 'error' => 'COR number does not match this CIP application.', 'field' => 'parentCorNumber'];
        }

        if (! self::isEligibleParent($match)) {
            return ['ok' => false, 'error' => 'The parent application must be granted.', 'field' => 'parentCipNumber'];
        }

        $open = self::openAddOn($match);

        return [
            'ok' => true,
            'parent' => self::parentPayload($match),
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

    public static function isEligibleParent(CipApplication $application): bool
    {
        if (($application->phase ?? '') === Phase::ADD_ON) {
            return false;
        }

        if (in_array($application->status, [Status::DENIED, Status::POST_DENIED], true)) {
            return false;
        }

        if (! filled($application->cip_number) || ! filled($application->cor_number)) {
            return false;
        }

        if ($application->status === Status::GRANTED
            || $application->decision === CipApplication::DECISION_GRANTED) {
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
            'status' => $parent->status,
            'statusLabel' => Status::label($parent->status),
            'providerId' => $parent->provider?->uuid,
            'providerName' => $parent->provider?->name,
            'investmentType' => $parent->investment_type,
        ];
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
