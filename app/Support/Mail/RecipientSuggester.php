<?php

namespace App\Support\Mail;

use App\Jobs\ResolveSenderPhoto;
use App\Models\Client;
use App\Models\Group;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\User;

/**
 * Phase-1 recipient suggestions for compose To/Cc/Bcc — no provider OAuth.
 *
 * Sources, in merge priority when the same email appears twice:
 *   1. portal users (staff / approved accounts)
 *   2. clients (staff viewers only)
 *   3. prior mail addresses from this user's mirrored mailbox
 * Groups are returned as expandable rows (all member emails) rather than a
 * single address, because portal groups have no mailbox of their own.
 *
 * Profile pictures reuse the same rule as the inbox: a portal avatar when the
 * person has an account, otherwise a cached sender photo (directory / Gravatar / brand)
 * via /portal/mail/sender-photo/{hash}. Never a live provider call here —
 * uncached addresses get a background ResolveSenderPhoto job instead.
 */
final class RecipientSuggester
{
    private const LIMIT = 12;

    private const PRIOR_SCAN = 200;

    /** @var list<string> */
    private const STAFF = ['Administrator', 'Employee'];

    /**
     * @return list<array<string, mixed>>
     */
    public static function suggest(User $viewer, string $query): array
    {
        $term = mb_strtolower(trim($query));
        $byEmail = [];
        $groups = [];

        foreach (self::portalUsers($viewer, $term) as $row) {
            self::put($byEmail, $row);
        }

        if (in_array($viewer->account_type, self::STAFF, true)) {
            foreach (self::clients($term) as $row) {
                self::put($byEmail, $row);
            }
            foreach (self::groups($viewer, $term) as $row) {
                $groups[] = $row;
            }
        }

        foreach (self::priorMail($viewer, $term) as $row) {
            self::put($byEmail, $row);
        }

        $people = array_values($byEmail);

        usort($people, function (array $a, array $b) use ($term) {
            $score = self::score($b, $term) <=> self::score($a, $term);
            if ($score !== 0) {
                return $score;
            }

            return strcasecmp($a['name'] ?: $a['email'], $b['name'] ?: $b['email']);
        });

        $out = array_slice($people, 0, self::LIMIT);

        foreach ($groups as $group) {
            if (count($out) >= self::LIMIT) {
                break;
            }
            $out[] = $group;
        }

        return self::withAvatars($viewer, $out);
    }

    /**
     * Prefer Microsoft / Google directory (or contact) photos — not portal uploads.
     *
     * Portal avatars are ignored on purpose: compose should show the face from
     * the mail provider (org directory, Google other-contacts, Gravatar), not
     * whatever someone uploaded on this site. Uncached addresses are resolved
     * inline (capped) so the first typeahead can show a real face.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private static function withAvatars(User $viewer, array $rows): array
    {
        $emails = [];
        foreach ($rows as $row) {
            if (! empty($row['email'])) {
                $emails[] = mb_strtolower((string) $row['email']);
            }
            if (($row['source'] ?? null) === 'group' && is_array($row['emails'] ?? null)) {
                foreach ($row['emails'] as $member) {
                    if (! empty($member['email'])) {
                        $emails[] = mb_strtolower((string) $member['email']);
                    }
                }
            }
        }
        $emails = array_values(array_unique($emails));
        if ($emails === []) {
            return $rows;
        }

        $account = Mailbox::accountFor($viewer);
        $own = $account ? mb_strtolower((string) $account->email) : null;
        $candidates = collect($emails)->reject(fn ($e) => $e === $own)->values();

        $cached = $candidates->isEmpty() ? collect() : MailSenderPhoto::query()
            ->whereIn('hash', $candidates->map(fn ($e) => MailSenderPhoto::hashFor($e)))
            ->get()
            ->keyBy(fn (MailSenderPhoto $p) => mb_strtolower((string) $p->email));

        if ($account) {
            $resolved = 0;
            foreach ($candidates as $email) {
                $row = $cached->get($email);
                // A fresh *hit* is done; a fresh *miss* is retried here because
                // earlier misses were often "queue never ran" or missing scopes,
                // not a real absence of a Microsoft/Google photo.
                if ($row && $row->isFresh() && $row->has_photo) {
                    continue;
                }
                if ($resolved >= 6) {
                    ResolveSenderPhoto::dispatch($account, $email);
                    continue;
                }
                try {
                    // Bust a stale miss so resolve() actually calls the provider.
                    if ($row && ! $row->has_photo) {
                        $row->forceFill(['checked_at' => now()->subDays(30)])->save();
                    }
                    MailSenderPhoto::resolve($account, $email);
                    $resolved++;
                } catch (\Throwable) {
                    ResolveSenderPhoto::dispatch($account, $email);
                }
            }

            if ($resolved > 0) {
                $cached = MailSenderPhoto::query()
                    ->whereIn('hash', $candidates->map(fn ($e) => MailSenderPhoto::hashFor($e)))
                    ->get()
                    ->keyBy(fn (MailSenderPhoto $p) => mb_strtolower((string) $p->email));
            }
        }

        foreach ($rows as &$row) {
            if (($row['source'] ?? null) === 'group' && is_array($row['emails'] ?? null)) {
                $row['avatarUrl'] = null;
                foreach ($row['emails'] as $member) {
                    $email = mb_strtolower((string) ($member['email'] ?? ''));
                    if ($url = self::directoryPhotoUrl($email, $cached)) {
                        $row['avatarUrl'] = $url;
                        break;
                    }
                }
                continue;
            }

            $email = mb_strtolower((string) ($row['email'] ?? ''));
            $row['avatarUrl'] = self::directoryPhotoUrl($email, $cached);
        }
        unset($row);

        return $rows;
    }

    /**
     * @param  \Illuminate\Support\Collection<string, MailSenderPhoto>  $cached
     */
    private static function directoryPhotoUrl(string $email, $cached): ?string
    {
        if ($email === '') {
            return null;
        }
        $photo = $cached->get($email);
        if ($photo && $photo->isFresh() && $photo->has_photo) {
            return route('mail.sender-photo', ['hash' => $photo->hash]);
        }

        return null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function portalUsers(User $viewer, string $term): array
    {
        $people = User::query()
            ->where('id', '!=', $viewer->id)
            ->where('status', User::STATUS_APPROVED)
            ->when($term !== '', function ($q) use ($term) {
                $needle = '%'.$term.'%';
                $q->where(function ($w) use ($needle) {
                    $w->whereRaw('lower(name) like ?', [$needle])
                        ->orWhereRaw('lower(email) like ?', [$needle]);
                });
            })
            ->orderBy('name')
            ->limit(self::LIMIT)
            ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url', 'account_type']);

        return $people->map(fn (User $u) => [
            'email' => mb_strtolower((string) $u->email),
            'name' => $u->name,
            'source' => 'staff',
            'sourceLabel' => 'Organization',
            'avatarUrl' => null, // filled from Microsoft/Google directory below
            'initial' => mb_strtoupper(mb_substr($u->name ?: $u->email, 0, 1)),
            'initialColor' => null,
            'emails' => null,
        ])->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function clients(string $term): array
    {
        $rows = Client::query()
            ->with(['user:id,email,avatar_url,provider_avatar_url'])
            ->when($term !== '', function ($q) use ($term) {
                $needle = '%'.$term.'%';
                $q->where(function ($w) use ($needle) {
                    $w->whereRaw('lower(name) like ?', [$needle])
                        ->orWhereRaw('lower(coalesce(company, \'\')) like ?', [$needle])
                        ->orWhereRaw('lower(coalesce(email, \'\')) like ?', [$needle]);
                });
            }, function ($q) {
                $q->whereNotNull('email')->where('email', '!=', '');
            })
            ->orderBy('name')
            ->limit(self::LIMIT)
            ->get(['name', 'company', 'email', 'user_id', 'initial', 'initial_color']);

        $out = [];
        foreach ($rows as $client) {
            $email = mb_strtolower(trim((string) $client->email));
            if ($email === '' || ! str_contains($email, '@')) {
                continue;
            }
            $out[] = [
                'email' => $email,
                'name' => $client->name ?: ($client->company ?: null),
                'source' => 'client',
                'sourceLabel' => 'Client',
                'avatarUrl' => null, // Microsoft/Google directory photo, not portal
                'initial' => $client->initial ?: mb_strtoupper(mb_substr($client->name ?: $email, 0, 1)),
                'initialColor' => $client->initial_color,
                'emails' => null,
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function groups(User $viewer, string $term): array
    {
        if ($term === '') {
            return [];
        }

        $groups = Group::query()
            ->with(['members.user' => fn ($q) => $q->select('id', 'name', 'email', 'status', 'avatar_url', 'provider_avatar_url')])
            ->where('is_archived', false)
            ->whereRaw('lower(name) like ?', ['%'.$term.'%'])
            ->orderBy('name')
            ->limit(5)
            ->get();

        $out = [];
        foreach ($groups as $group) {
            $members = $group->members
                ->map(fn ($m) => $m->user)
                ->filter(fn ($u) => $u && $u->status === User::STATUS_APPROVED && $u->id !== $viewer->id && $u->email)
                ->unique('id')
                ->values();

            if ($members->isEmpty()) {
                continue;
            }

            $emails = $members->map(fn (User $u) => [
                'email' => mb_strtolower((string) $u->email),
                'name' => $u->name,
            ])->values()->all();

            $face = $members->first();

            $out[] = [
                'email' => null,
                'name' => $group->name,
                'source' => 'group',
                'sourceLabel' => 'Group · '.$members->count().' '.($members->count() === 1 ? 'person' : 'people'),
                'avatarUrl' => null, // Microsoft/Google directory photo for a member
                'initial' => mb_strtoupper(mb_substr($group->name, 0, 1)),
                'initialColor' => null,
                'emails' => $emails,
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function priorMail(User $viewer, string $term): array
    {
        $messages = MailMessage::query()
            ->where('user_id', $viewer->id)
            ->orderByDesc('sent_at')
            ->limit(self::PRIOR_SCAN)
            ->get(['from_name', 'from_email', 'to', 'cc', 'bcc']);

        $counts = [];
        $names = [];

        foreach ($messages as $message) {
            self::tallyAddress($counts, $names, $message->from_email, $message->from_name);
            foreach (['to', 'cc', 'bcc'] as $field) {
                $list = $message->{$field};
                if (! is_array($list)) {
                    continue;
                }
                foreach ($list as $entry) {
                    if (! is_array($entry)) {
                        continue;
                    }
                    self::tallyAddress($counts, $names, $entry['email'] ?? null, $entry['name'] ?? null);
                }
            }
        }

        $self = mb_strtolower((string) $viewer->email);
        unset($counts[$self], $names[$self]);

        $rows = [];
        foreach ($counts as $email => $count) {
            if ($term !== '' && ! str_contains($email, $term) && ! str_contains(mb_strtolower((string) ($names[$email] ?? '')), $term)) {
                continue;
            }
            $rows[] = [
                'email' => $email,
                'name' => $names[$email] ?? null,
                'source' => 'prior',
                'sourceLabel' => 'Previous email',
                'avatarUrl' => null,
                'initial' => mb_strtoupper(mb_substr($names[$email] ?? $email, 0, 1)),
                'initialColor' => null,
                'emails' => null,
                '_count' => $count,
            ];
        }

        usort($rows, fn ($a, $b) => ($b['_count'] <=> $a['_count']) ?: strcasecmp($a['email'], $b['email']));

        return array_map(function (array $row) {
            unset($row['_count']);

            return $row;
        }, array_slice($rows, 0, self::LIMIT));
    }

    private static function tallyAddress(array &$counts, array &$names, mixed $email, mixed $name): void
    {
        $email = mb_strtolower(trim((string) $email));
        if ($email === '' || ! str_contains($email, '@')) {
            return;
        }
        $counts[$email] = ($counts[$email] ?? 0) + 1;
        $name = is_string($name) ? trim($name) : '';
        if ($name !== '' && empty($names[$email])) {
            $names[$email] = $name;
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $byEmail
     * @param  array<string, mixed>  $row
     */
    private static function put(array &$byEmail, array $row): void
    {
        $email = $row['email'] ?? null;
        if (! is_string($email) || $email === '') {
            return;
        }

        if (! isset($byEmail[$email])) {
            $byEmail[$email] = $row;

            return;
        }

        $rank = ['staff' => 3, 'client' => 2, 'prior' => 1];
        $existing = $byEmail[$email];
        if (($rank[$row['source']] ?? 0) > ($rank[$existing['source']] ?? 0)) {
            if (empty($row['avatarUrl']) && ! empty($existing['avatarUrl'])) {
                $row['avatarUrl'] = $existing['avatarUrl'];
            }
            $byEmail[$email] = $row;
        } elseif (empty($existing['avatarUrl']) && ! empty($row['avatarUrl'])) {
            $byEmail[$email]['avatarUrl'] = $row['avatarUrl'];
        }
    }

    /** @param  array<string, mixed>  $row */
    private static function score(array $row, string $term): int
    {
        $sourceBoost = ['staff' => 30, 'client' => 20, 'prior' => 10][$row['source']] ?? 0;
        if ($term === '') {
            return $sourceBoost;
        }

        $email = (string) ($row['email'] ?? '');
        $name = mb_strtolower((string) ($row['name'] ?? ''));
        $match = 0;
        if (str_starts_with($email, $term)) {
            $match = 100;
        } elseif (str_starts_with($name, $term)) {
            $match = 80;
        } elseif (str_contains($email, $term) || str_contains($name, $term)) {
            $match = 40;
        }

        return $match + $sourceBoost;
    }
}
