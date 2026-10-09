<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Who is copied on every notice because of the investment, not the firm.
 *
 * A Real Estate Project has a developer behind it, an Enterprise Project a
 * promoter; both want every notice on an application that funds them
 * whichever service provider filed it. The firm keeps, per investment type,
 * the providers on the register whose contacts are copied and any extra
 * mailboxes, in portal_settings so it is an administrator's to change on
 * Settings › CIP Console rather than a deploy.
 *
 * Shape: { "<investment type>": { "providerIds": [uuid, …], "emails": [ … ] } }.
 */
class InvestmentCopies
{
    public const KEY = 'cip.investment_copies';

    private static ?array $memo = null;

    /**
     * Every investment type's copy list, empty lists where nothing is kept.
     *
     * @return array<string, array{providerIds: list<string>, emails: list<string>}>
     */
    public static function all(): array
    {
        $stored = self::stored();
        $out = [];

        foreach (array_keys(InvestmentType::ALL) as $type) {
            $row = is_array($stored[$type] ?? null) ? $stored[$type] : [];
            $out[$type] = [
                'providerIds' => self::cleanIds($row['providerIds'] ?? []),
                'emails' => self::cleanEmails($row['emails'] ?? []),
            ];
        }

        return $out;
    }

    /**
     * @param  array<string, array{providerIds?: mixed, emails?: mixed}>  $copies
     * @return array<string, array{providerIds: list<string>, emails: list<string>}>
     */
    public static function put(array $copies, ?int $userId = null): array
    {
        $clean = [];

        foreach (array_keys(InvestmentType::ALL) as $type) {
            $row = is_array($copies[$type] ?? null) ? $copies[$type] : [];
            $clean[$type] = [
                'providerIds' => self::cleanIds($row['providerIds'] ?? []),
                'emails' => self::cleanEmails($row['emails'] ?? []),
            ];
        }

        DB::table('portal_settings')->updateOrInsert(
            ['key' => self::KEY],
            [
                'value' => json_encode($clean),
                'updated_at' => now(),
                'updated_by' => $userId,
            ],
        );

        self::flush();

        return $clean;
    }

    /**
     * The people copied on this application because of what it invests in.
     *
     * The configured providers' contacts, the same three mailboxes a firm's
     * own provider side gets, and the extra addresses. The filing firm is
     * already a recipient in its own right, so a developer that is also the
     * filing firm is simply one mailbox again; {@see Contacts::notices}
     * folds duplicates.
     *
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    public static function recipients(CipApplication $application): array
    {
        $type = (string) ($application->investment_type ?? '');
        if ($type === '' || ! InvestmentType::isValid($type)) {
            return [];
        }

        $row = self::all()[$type];
        if ($row['providerIds'] === [] && $row['emails'] === []) {
            return [];
        }

        $recipients = [];

        if ($row['providerIds'] !== []) {
            $providers = CipProvider::query()
                ->whereIn('uuid', $row['providerIds'])
                ->where('active', true)
                ->with('company')
                ->get();

            foreach ($providers as $provider) {
                foreach (Contacts::providerContacts($provider) as $recipient) {
                    $recipients[mb_strtolower($recipient['email'])] = $recipient;
                }
            }
        }

        foreach ($row['emails'] as $email) {
            $key = mb_strtolower($email);
            if (! isset($recipients[$key])) {
                $recipients[$key] = ['email' => $email, 'name' => null, 'userId' => null];
            }
        }

        return array_values($recipients);
    }

    public static function flush(): void
    {
        self::$memo = null;
        Cache::forget('portal-settings.'.self::KEY);
    }

    /**
     * @param  mixed  $ids
     * @return list<string>
     */
    private static function cleanIds(mixed $ids): array
    {
        if (! is_array($ids)) {
            return [];
        }

        $clean = [];
        foreach ($ids as $id) {
            $id = trim((string) $id);
            if ($id !== '' && mb_strlen($id) <= 64) {
                $clean[$id] = $id;
            }
        }

        return array_values($clean);
    }

    /**
     * @param  mixed  $emails
     * @return list<string>
     */
    private static function cleanEmails(mixed $emails): array
    {
        if (! is_array($emails)) {
            return [];
        }

        $clean = [];
        foreach ($emails as $email) {
            $email = trim((string) $email);
            if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                continue;
            }
            $clean[mb_strtolower($email)] = $email;
        }

        return array_values($clean);
    }

    /** @return array<string, mixed> */
    private static function stored(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        try {
            $stored = Cache::remember('portal-settings.'.self::KEY, 60, function () {
                $row = DB::table('portal_settings')->where('key', self::KEY)->first();

                return $row ? (json_decode($row->value, true) ?: []) : [];
            });
        } catch (Throwable) {
            return [];
        }

        return self::$memo = is_array($stored) ? $stored : [];
    }
}
