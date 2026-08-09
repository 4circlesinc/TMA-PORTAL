<?php

namespace App\Support\Cbi;

use App\Models\CbiApplication;
use App\Models\User;
use App\Support\Access\Role;

/**
 * One person, one assignee.
 *
 * "Assigned To" is a free-text Smartsheet cell, so the same colleague appears
 * as "Dincel", "Dincel Baptiste", and "Dincel Baptiste <dbaptiste@…>" — three
 * rows in every filter list, three slices of what is one person's workload.
 * This folds the spellings back together and, where the firm already has an
 * account for them, points the application at it.
 *
 * The folding rule is the cautious one used for referral companies: a bare
 * first name only joins a fuller name when **exactly one** fuller name in the
 * whole caseload starts with it. Two colleagues called Maria would keep their
 * separate rows rather than be silently merged, which is the right way round —
 * a split workload is visible and fixable, a merged one is neither.
 *
 * No accounts are created. A name with nobody behind it stays a name.
 */
class AssigneeDirectory
{
    /** @var array<string, array{name: string, user: ?User}> raw value => resolution */
    private array $resolved = [];

    /** @var array<int, array{canonical: string, user: ?User, raw: array<int, string>, applications: int}> */
    private array $groups = [];

    private function __construct() {}

    /**
     * Read every assignee the caseload holds and work out who is who.
     */
    public static function build(): self
    {
        $directory = new self;

        $rows = CbiApplication::query()
            ->selectRaw('assigned_to, count(*) as n')
            ->whereNotNull('assigned_to')
            ->where('assigned_to', '!=', '')
            ->groupBy('assigned_to')
            ->get();

        /** @var array<string, array{variants: array<int, array{name: string, n: int}>, raw: array<int, string>, emails: array<int, string>, n: int}> $byName */
        $byName = [];
        foreach ($rows as $row) {
            $raw = (string) $row->assigned_to;
            if (Names::isEmptyMarker($raw)) {
                continue;
            }

            $parts = Names::splitEmail($raw);
            // An address with no name in front of it still identifies somebody;
            // key it on the address so it can find its account.
            $key = Names::normalise($parts['name'] !== '' ? $parts['name'] : (string) $parts['email']);
            if ($key === '') {
                continue;
            }

            $byName[$key]['variants'][] = ['name' => $parts['name'] !== '' ? $parts['name'] : $raw, 'n' => (int) $row->n];
            $byName[$key]['raw'][] = $raw;
            $byName[$key]['n'] = ($byName[$key]['n'] ?? 0) + (int) $row->n;
            if ($parts['email']) {
                $byName[$key]['emails'][] = $parts['email'];
            }
        }

        $directory->groups = $directory->fold($byName);
        $directory->matchUsers();
        $directory->index();

        return $directory;
    }

    /**
     * Fold "Dincel" into "Dincel Baptiste" — but only where there is exactly
     * one candidate to fold into.
     *
     * @param  array<string, array{variants: array<int, array{name: string, n: int}>, raw: array<int, string>, emails?: array<int, string>, n: int}>  $byName
     * @return array<int, array{canonical: string, user: ?User, raw: array<int, string>, emails: array<int, string>, applications: int, variants: array<int, array{name: string, n: int}>}>
     */
    private function fold(array $byName): array
    {
        $single = [];
        $multi = [];
        foreach ($byName as $key => $group) {
            if (str_contains($key, ' ')) {
                $multi[$key] = $group;
            } else {
                $single[$key] = $group;
            }
        }

        foreach ($single as $key => $group) {
            $candidates = [];
            foreach ($multi as $fullKey => $_) {
                if (str_starts_with($fullKey, $key.' ')) {
                    $candidates[] = $fullKey;
                }
            }

            // Nobody to fold into, or more than one — either way, leave it be.
            if (count($candidates) !== 1) {
                $multi[$key] = $group;

                continue;
            }

            $into = $candidates[0];
            $multi[$into]['variants'] = array_merge($multi[$into]['variants'], $group['variants']);
            $multi[$into]['raw'] = array_merge($multi[$into]['raw'], $group['raw']);
            $multi[$into]['emails'] = array_merge($multi[$into]['emails'] ?? [], $group['emails'] ?? []);
            $multi[$into]['n'] += $group['n'];
        }

        $groups = [];
        foreach ($multi as $group) {
            $groups[] = [
                'canonical' => Names::display($group['variants']),
                'user' => null,
                'raw' => array_values(array_unique($group['raw'])),
                'emails' => array_values(array_unique($group['emails'] ?? [])),
                'applications' => $group['n'],
                'variants' => $group['variants'],
            ];
        }

        usort($groups, fn ($a, $b) => $b['applications'] <=> $a['applications']);

        return $groups;
    }

    /**
     * Attach the firm's own account where there is one.
     *
     * By name before address, deliberately: one colleague's rows carry a shared
     * `processing@` mailbox, which belongs to no person, while their name
     * matches their account exactly. The name is who did the work; the address
     * is only where the mail went.
     */
    private function matchUsers(): void
    {
        $staff = User::whereIn('account_type', Role::STAFF)->get();

        $byName = [];
        $byEmail = [];
        foreach ($staff as $user) {
            $byName[Names::normalise((string) $user->name)] = $user;
            $byEmail[mb_strtolower((string) $user->email)] = $user;
        }

        foreach ($this->groups as $i => $group) {
            $user = $byName[Names::normalise($group['canonical'])] ?? null;

            if (! $user) {
                foreach ($group['emails'] as $email) {
                    if (isset($byEmail[$email])) {
                        $user = $byEmail[$email];
                        break;
                    }
                }
            }

            $this->groups[$i]['user'] = $user;
            // The account's own spelling of their name wins once matched: it
            // is the one the rest of the portal shows them under.
            if ($user) {
                $this->groups[$i]['canonical'] = $user->name;
            }
        }
    }

    private function index(): void
    {
        foreach ($this->groups as $group) {
            foreach ($group['raw'] as $raw) {
                $this->resolved[$raw] = ['name' => $group['canonical'], 'user' => $group['user']];
            }
        }
    }

    /**
     * @return array{name: ?string, user: ?User}
     */
    public function resolve(?string $raw): array
    {
        if ($raw === null || Names::isEmptyMarker($raw)) {
            return ['name' => null, 'user' => null];
        }

        return $this->resolved[$raw] ?? ['name' => Names::tidy($raw), 'user' => null];
    }

    /**
     * @return array<int, array{canonical: string, user: ?User, raw: array<int, string>, applications: int}>
     */
    public function groups(): array
    {
        return $this->groups;
    }
}
