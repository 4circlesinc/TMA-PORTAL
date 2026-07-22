<?php

namespace App\Support\Dashboard;

use App\Models\Client;
use App\Models\User;

/**
 * Who counts as "a client" when measuring how quickly staff answer them.
 *
 * A client reaches the firm through two doors — a portal login (a user whose
 * account_type is Client) and an email address in the client directory — and
 * the same person may hold both. Every metric therefore resolves an actor to a
 * stable *client key* so one person waiting on both channels is counted once.
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

        // Directory records first, so a client with both a record and a login
        // is keyed by the record and the login folds into it below.
        foreach (Client::query()->get(['id', 'uid', 'user_id', 'name', 'email']) as $client) {
            $key = 'client:'.$client->uid;
            $names[$key] = $client->name;

            if ($client->user_id !== null) {
                $keyByUserId[$client->user_id] = $key;
            }

            if ($client->email) {
                $keyByEmail[mb_strtolower($client->email)] = $key;
            }
        }

        // Client logins with no directory record still count — they are people
        // waiting on a reply whether or not anyone filed them under Clients.
        $logins = User::query()
            ->where('account_type', 'Client')
            ->get(['id', 'name', 'email']);

        foreach ($logins as $login) {
            $key = $keyByUserId[$login->id] ?? 'user:'.$login->id;
            $keyByUserId[$login->id] = $key;
            $names[$key] ??= $login->name;

            if ($login->email) {
                $keyByEmail[mb_strtolower($login->email)] ??= $key;
            }
        }

        return new self($keyByUserId, $keyByEmail, $names);
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
}
