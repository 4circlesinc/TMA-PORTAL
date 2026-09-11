<?php

namespace App\Support\Bespoke;

use App\Models\User;
use App\Models\UserBlock;
use App\Support\Access\ContactScope;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Who Bespoke may name, and who it may draft a message to.
 *
 * The reach is exactly Messages' own: staff see the approved directory, a
 * client sees the staff assigned to them plus every administrator. Blocks
 * cut both ways. Nothing here widens what the Messages page would show.
 */
final class People
{
    /** Job-title words that mark the person to contact about the portal itself. */
    private const TECH_TITLE = '/\b(it|web|developer|software|technology|technical|systems?)\b/i';

    private const ROLE_WORDS = [
        'administrator' => Role::ADMINISTRATOR,
        'administrators' => Role::ADMINISTRATOR,
        'administration' => Role::ADMINISTRATOR,
        'admin' => Role::ADMINISTRATOR,
        'admins' => Role::ADMINISTRATOR,
        'officer' => Role::REVIEWING_OFFICER,
        'officers' => Role::REVIEWING_OFFICER,
        'reviewer' => Role::REVIEWING_OFFICER,
        'cro' => Role::REVIEWING_OFFICER,
    ];

    private const TECH_WORDS = ['it', 'tech', 'technical', 'technology', 'web', 'developer', 'dev', 'website', 'portal', 'bug', 'login', 'sign-in', 'password'];

    /**
     * Search the people this reader may message. Terms match name, email,
     * job title, or account type; a role word such as "administrator" or
     * "IT" widens to everyone holding that role or a technical title.
     *
     * @return list<array<string, mixed>>
     */
    public static function search(User $viewer, string $query, int $limit = 8): array
    {
        $terms = array_values(array_filter(preg_split('/[\s,]+/u', mb_strtolower(trim($query))) ?: []));

        $builder = self::reachable($viewer);

        if ($terms !== []) {
            $builder->where(function (Builder $q) use ($terms) {
                foreach ($terms as $term) {
                    $q->where(function (Builder $w) use ($term) {
                        $needle = '%'.$term.'%';
                        $w->whereRaw('lower(name) like ?', [$needle])
                            ->orWhereRaw('lower(email) like ?', [$needle])
                            ->orWhereRaw('lower(coalesce(job_title, \'\')) like ?', [$needle]);
                        if (isset(self::ROLE_WORDS[$term])) {
                            $w->orWhere('account_type', self::ROLE_WORDS[$term]);
                        }
                        if (in_array($term, self::TECH_WORDS, true)) {
                            $w->orWhere(function (Builder $t) {
                                foreach (['it', 'web', 'developer', 'software', 'technolog', 'technical', 'system'] as $word) {
                                    $t->orWhereRaw('lower(coalesce(job_title, \'\')) like ?', ['%'.$word.'%']);
                                }
                            });
                        }
                    });
                }
            });
        }

        $rows = $builder->orderBy('name')->limit(max(1, min(20, $limit)))->get();

        return $rows->map(fn (User $u) => self::row($u))->values()->all();
    }

    /** One reachable person by id, or null when this reader may not message them. */
    public static function reachableById(User $viewer, int $id): ?User
    {
        if ($id <= 0 || $id === $viewer->id) {
            return null;
        }

        return self::reachable($viewer)->whereKey($id)->first();
    }

    /**
     * Facts for the prompt: the administrators this reader can reach, and
     * the person whose job title says they look after the portal.
     *
     * @return array{administrators: list<string>, technical: list<array{name: string, title: string}>}
     */
    public static function facts(User $viewer): array
    {
        $people = self::reachable($viewer)
            ->whereIn('account_type', Role::STAFF)
            ->orderBy('name')
            ->limit(200)
            ->get(['id', 'name', 'account_type', 'job_title']);

        $administrators = $people
            ->filter(fn (User $u) => Role::isAdmin($u))
            ->map(fn (User $u) => (string) $u->name)
            ->values()
            ->all();

        $technical = $people
            ->filter(fn (User $u) => is_string($u->job_title) && preg_match(self::TECH_TITLE, $u->job_title) === 1)
            ->map(fn (User $u) => ['name' => (string) $u->name, 'title' => (string) $u->job_title])
            ->values()
            ->all();

        return ['administrators' => $administrators, 'technical' => $technical];
    }

    /** @return array<string, mixed> */
    public static function row(User $u): array
    {
        return [
            'userId' => $u->id,
            'name' => $u->name,
            'accountType' => Role::of($u) ?: $u->account_type,
            'jobTitle' => $u->job_title ?: null,
            'email' => $u->email,
            'canMessage' => true,
        ];
    }

    private static function reachable(User $viewer): Builder
    {
        $blocked = UserBlock::query()
            ->where('user_id', $viewer->id)->pluck('blocked_user_id')
            ->merge(UserBlock::query()->where('blocked_user_id', $viewer->id)->pluck('user_id'))
            ->unique()
            ->values();

        $reachable = ContactScope::visibleUserIds($viewer);

        return User::query()
            ->where('id', '!=', $viewer->id)
            ->where('status', User::STATUS_APPROVED)
            ->when($blocked->isNotEmpty(), fn (Builder $q) => $q->whereNotIn('id', $blocked))
            ->when($reachable !== null, fn (Builder $q) => $q->whereIn('id', $reachable));
    }
}
