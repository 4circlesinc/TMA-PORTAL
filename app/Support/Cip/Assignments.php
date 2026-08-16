<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Handing an application to an officer (§10), and taking it back again.
 *
 * cip_application_assignments is the authority and this is its one writer: a
 * file is held by one person per role at a time, an assignment ends rather
 * than disappears so the record keeps everybody who ever held it, and
 * cip_applications.assigned_officer_id is only a cache of the live row — kept
 * so §8's table can name the officer without a join per line.
 *
 * §10 makes assignment a lifecycle event as well as a piece of bookkeeping:
 * giving a NEW application to an officer is what starts the review. That half
 * goes through {@see Engine} like every other status change — nothing here
 * writes cip_applications.status — and it happens only from NEW. §26 lets an
 * administrator reassign at any time, and a file that has reached assessment
 * feedback has not gone back to the beginning because it changed hands.
 *
 * Sibling to {@see \App\Support\Clients\Assignments}, which does the same job
 * for a client in the hub. The two should read alike.
 */
class Assignments
{
    /**
     * The jobs a file can be held in, and what each is called.
     *
     * Keyed on {@see CipAccess}'s two officer roles on purpose: the role on an
     * assignment row and the role an account type carries are the same
     * vocabulary, so "assign a Reviewing Officer" and "is a Reviewing Officer"
     * cannot drift into two spellings.
     */
    public const ROLES = [
        CipAccess::REVIEWING_OFFICER => 'Reviewing officer',
        CipAccess::COMPLIANCE_OFFICER => 'Compliance officer',
    ];

    /**
     * Who may hand a file to an officer.
     *
     * §10 gives this to the Administrator, and the matrix agrees — in the way
     * the matrix says it. `cip.assign => []` looks like a grant to nobody, but
     * an empty row means administrators only: {@see Role::can} answers true
     * for an administrator before it ever reads the row. Both halves are
     * written out here anyway. The capability is the live test, so the day the
     * firm widens that row to an officer type the screens follow without an
     * edit; naming the administrator beside it keeps §10 true whatever the row
     * says. The enabled() guard is what the isAdmin half would otherwise walk
     * straight past — while FEATURE_CIP is off the module does not exist for
     * anyone, administrators included.
     */
    public static function canAssign(?User $user): bool
    {
        return $user !== null
            && CipAccess::enabled()
            && (Role::isAdmin($user) || CipAccess::can($user, 'cip.assign'));
    }

    /**
     * Give the application to this officer, in this job.
     *
     * Whoever held it in the same job stops holding it, in the same
     * transaction that hands it on, so a file is never held twice or by
     * nobody. Reassignment is allowed at any point of the lifecycle (§26) —
     * only the move out of NEW is conditional, because that one is §10's
     * "assignment starts the review" and not a property of assignment itself.
     */
    public static function assign(
        CipApplication $application,
        User $officer,
        User $actor,
        string $role = CipAccess::REVIEWING_OFFICER,
    ): CipApplicationAssignment {
        $held = self::live($application)->firstWhere('role', $role);

        // Handing the file to the person who already has it is not a change.
        // An inline picker that fires twice must not read, a year later, as
        // one officer losing the application and being given it back a second
        // afterwards.
        if ($held && $held->user_id === $officer->id) {
            return $held;
        }

        $assignment = DB::transaction(function () use ($application, $officer, $actor, $role, $held) {
            $held?->end($actor);

            $assignment = CipApplicationAssignment::create([
                'application_id' => $application->id,
                'user_id' => $officer->id,
                'role' => $role,
                'status' => CipApplicationAssignment::STATUS_ACTIVE,
                'assigned_by' => $actor->id,
                'starts_at' => now(),
            ]);

            self::refreshCache($application);

            $meta = ['officer' => $officer->name, 'officerId' => $officer->id, 'role' => $role];

            if ($held) {
                $meta['replaced'] = $held->user?->name;
            }

            Engine::record($application, CipEvent::ACTION_ASSIGNED, $actor, $meta);

            /*
             * §10 in one line: the file being assigned is what puts it into
             * review. Only from NEW — an application further down the
             * lifecycle is changing hands, and driving it back to REVIEW
             * APPLICATION to record that would throw away the reviewer's work
             * and tell every dashboard the file had started again.
             */
            if ($application->status === Status::NEW) {
                Engine::apply($application, Status::REVIEW_APPLICATION, $actor, [
                    'officer' => $officer->name,
                    'role' => $role,
                ]);
            }

            return $assignment;
        });

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'cip.assigned',
            'module' => 'cip',
            'description' => $application->displayNumber().' assigned to '.$officer->name
                .' as '.self::roleLabel($role),
            'subject' => $application,
        ]);

        self::announceAssigned($application, $assignment);

        return $assignment;
    }

    /**
     * Take the file off somebody.
     *
     * The status stays exactly where it is. An application between officers is
     * still under review — there is no edge back out of REVIEW APPLICATION,
     * and inventing one so an empty "Assigned To" column looked tidy would be
     * rewriting the file's history to describe the staffing.
     */
    public static function end(CipApplicationAssignment $assignment, User $actor): CipApplicationAssignment
    {
        $application = $assignment->loadMissing(['application', 'user'])->application;
        $officer = $assignment->user;

        DB::transaction(function () use ($assignment, $application, $officer, $actor) {
            $assignment->end($actor);

            self::refreshCache($application);

            Engine::record($application, CipEvent::ACTION_UNASSIGNED, $actor, [
                'officer' => $officer?->name,
                'officerId' => $assignment->user_id,
                'role' => $assignment->role,
            ]);
        });

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'cip.unassigned',
            'module' => 'cip',
            'description' => ($officer?->name ?? 'An officer').' no longer holds '.$application->displayNumber(),
            'subject' => $application,
        ]);

        return $assignment->fresh();
    }

    /**
     * Who holds this application now, in the order they were given it.
     *
     * Queried rather than read off the relation: assignment changes and the
     * cache that follows them happen inside one request, and a relation loaded
     * before the change would answer with the world as it was.
     *
     * @return Collection<int, CipApplicationAssignment>
     */
    public static function live(CipApplication $application): Collection
    {
        return CipApplicationAssignment::live()
            ->where('application_id', $application->id)
            // Both photo columns, because photoUrl() falls back from one to
            // the other and a column that was never selected reads as empty.
            ->with('user:id,name,email,avatar_url,provider_avatar_url')
            ->orderBy('id')
            ->get();
    }

    /**
     * The officers this application could be handed to.
     *
     * {@see Role::OFFICERS} is the list, and it is the right one twice over.
     * An administrator is absent because they reach every application already
     * (see {@see ApplicationScope}), so a row for them would grant nothing and
     * imply they had been singled out for this one file; the parked Employee
     * type is absent because those accounts cannot reach the portal at all,
     * and offering one would promise work to somebody who could never open it.
     * Anybody already holding the file is excluded for the plainest reason —
     * the list would be offering work that is already theirs.
     *
     * @return Collection<int, User>
     */
    public static function assignable(CipApplication $application): Collection
    {
        $held = self::live($application)->pluck('user_id')->all();

        return User::query()
            ->whereIn('account_type', Role::OFFICERS)
            ->where('status', 'approved')
            ->whereNotIn('id', $held)
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url', 'account_type']);
    }

    public static function roleLabel(?string $role): string
    {
        return self::ROLES[$role] ?? 'Officer';
    }

    /**
     * Put the cache column back in step with the table that owns the answer.
     *
     * assigned_officer_id is written here and nowhere else. The reviewing
     * officer wins when a file is held in both jobs, because §8's column asks
     * who is working it; a file nobody holds reads null rather than keeping
     * the last person who did.
     */
    /**
     * Bring `cip_applications.assigned_officer_id` back into step.
     *
     * Public because this class is not the only thing that ends an assignment:
     * suspending an account ends every file it holds (see AccessSync), and
     * without this the row would say nobody holds the file while the cache
     * went on naming the suspended officer — and every screen reads the cache.
     */
    public static function refreshCache(CipApplication $application): void
    {
        $live = self::live($application);
        $holder = $live->firstWhere('role', CipAccess::REVIEWING_OFFICER) ?? $live->first();

        $application->forceFill(['assigned_officer_id' => $holder?->user_id])->save();
    }

    /**
     * Phase 5 attaches here: telling the officer the file is theirs.
     *
     * §10 fixes what that message carries — the application number from
     * {@see CipApplication::displayNumber()} so a submitted file is named by
     * its CIP number rather than the internal one, the main applicant's name,
     * the service provider, and a direct link to the application at
     * /cip/applications/{uuid}. Nothing is sent yet: the notification engine
     * is phase 5, and a mailer invented here would have to be unpicked the day
     * it arrives.
     */
    private static function announceAssigned(CipApplication $application, CipApplicationAssignment $assignment): void {}
}
