<?php

namespace App\Support\Dashboard;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\CompanyMember;
use App\Models\User;

/**
 * Who counts as "a client" when measuring how quickly staff answer them.
 *
 * A client reaches the firm through two doors, a portal login tied to a
 * client record (or a Client account that is not a service-provider contact)
 * and an email address in the client directory, and the same person may hold
 * both. Every metric therefore resolves an actor to a stable *client key* so
 * one person waiting on both channels is counted once.
 *
 * Service-provider contacts also use account_type Client, but they are the
 * firm on the other side of a case, not the applicant being answered. They
 * must not move "Avg. Response to Clients".
 */
final class ClientDirectory
{
    /**
     * @param  array<int, string>  $keyByUserId  portal user id => client key
     * @param  array<string, string>  $keyByEmail  lower-case email => client key
     * @param  array<string, string>  $names  client key => display name
     */
    private function __construct(
        public readonly array $keyByUserId,
        public readonly array $keyByEmail,
        public readonly array $names,
    ) {}

    public static function load(): self
    {
        $keyByUserId = [];
        $keyByEmail = [];
        $names = [];

        // A service-provider contact is often given a client row when they are
        // invited. That row must not put their mail back into this directory:
        // answering the firm on the case is not answering the applicant.
        $providerContactIds = array_flip(self::providerContactUserIds());
        $providerEmails = array_flip(self::providerContactEmails());

        // Directory records first, so a client with both a record and a login
        // is keyed by the record and the login folds into it below.
        foreach (Client::query()->get(['id', 'uid', 'user_id', 'name', 'email']) as $client) {
            if ($client->user_id !== null && isset($providerContactIds[(int) $client->user_id])) {
                continue;
            }

            $email = $client->email ? mb_strtolower($client->email) : null;
            if ($email !== null && isset($providerEmails[$email])) {
                continue;
            }

            $key = 'client:'.$client->uid;
            $names[$key] = $client->name;

            if ($client->user_id !== null) {
                $keyByUserId[$client->user_id] = $key;
            }

            if ($email !== null) {
                $keyByEmail[$email] = $key;
            }
        }

        // Client logins with no directory record still count, they are people
        // waiting on a reply whether or not anyone filed them under Clients.
        // Provider-firm contacts are the exception: they share the Client
        // account type but they are not the applicant.
        $logins = User::query()
            ->where('account_type', 'Client')
            ->get(['id', 'name', 'email']);

        foreach ($logins as $login) {
            if (isset($providerContactIds[$login->id])) {
                continue;
            }

            $key = $keyByUserId[$login->id] ?? 'user:'.$login->id;
            $keyByUserId[$login->id] = $key;
            $names[$key] ??= $login->name;

            if ($login->email) {
                $keyByEmail[mb_strtolower($login->email)] ??= $key;
            }
        }

        return new self($keyByUserId, $keyByEmail, $names);
    }

    /** Nobody in the directory. Used when the KPI row does not measure staff replies. */
    public static function none(): self
    {
        return new self([], [], []);
    }

    /** @return list<int> */
    public function userIds(): array
    {
        return array_map('intval', array_keys($this->keyByUserId));
    }

    /** @return list<string> */
    public function emails(): array
    {
        return array_keys($this->keyByEmail);
    }

    public function keyForUser(int $userId): ?string
    {
        return $this->keyByUserId[$userId] ?? null;
    }

    public function keyForEmail(?string $email): ?string
    {
        return $email ? ($this->keyByEmail[mb_strtolower($email)] ?? null) : null;
    }

    public function isEmpty(): bool
    {
        return $this->keyByUserId === [] && $this->keyByEmail === [];
    }

    /** @return list<int> */
    private static function providerContactUserIds(): array
    {
        return CompanyMember::query()
            ->active()
            ->whereIn('company_id', self::providerCompanyIds())
            ->whereNotNull('user_id')
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Addresses those contacts write from, on the membership and on the login.
     * Mail is matched by address, so leaving either one in would still count
     * an answer to the firm as an answer to an applicant.
     *
     * @return list<string>
     */
    private static function providerContactEmails(): array
    {
        $companies = self::providerCompanyIds();

        $fromMembers = CompanyMember::query()
            ->active()
            ->whereIn('company_id', $companies)
            ->pluck('email');

        $fromLogins = User::query()
            ->whereIn(
                'id',
                CompanyMember::query()
                    ->active()
                    ->whereIn('company_id', $companies)
                    ->whereNotNull('user_id')
                    ->select('user_id')
            )
            ->pluck('email');

        return $fromMembers->merge($fromLogins)
            ->map(fn ($email) => mb_strtolower(trim((string) $email)))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private static function providerCompanyIds(): \Illuminate\Database\Eloquent\Builder
    {
        return CipProvider::query()->select('company_id')->whereNotNull('company_id');
    }
}
