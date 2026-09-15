<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipEvent;
use App\Models\ClientAssignment;
use App\Models\CompanyStaffAssignment;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\Assignments as ClientAssignments;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Handing an application to an officer (section 10), and taking it back again.
 *
 * cip_application_assignments is the authority and this is its one writer: a
 * file is held by one person per role at a time, an assignment ends rather
 * than disappears so the record keeps everybody who ever held it, and
 * cip_applications.assigned_officer_id is only a cache of the live row, kept
 * so section 8's table can name the officer without a join per line.
 *
 * Section 10 makes assignment a lifecycle event as well as a piece of bookkeeping:
 * giving a NEW application to an officer is what starts the review. That half
 * goes through {@see Engine} like every other status change, nothing here
 * writes cip_applications.status, and it happens only from NEW. Section 26 lets an
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
     * Mark on company assignments this workflow writes for itself, so ending
     * the last file can take the firm back without touching grants an
     * administrator made by hand.
     */
    public const AUTO_NOTE = 'cip:auto-assigned with the application';

    /**
     * Who may hand a file to an officer.
     *
     * Section 10 gives this to the Administrator, and the matrix agrees, in the way
     * the matrix says it. `cip.assign => []` looks like a grant to nobody, but
     * an empty row means administrators only: {@see Role::can} answers true
     * for an administrator before it ever reads the row. Both halves are
     * written out here anyway. The capability is the live test, so the day the
     * firm widens that row to an officer type the screens follow without an
     * edit; naming the administrator beside it keeps section 10 true whatever the row
     * says. The enabled() guard is what the isAdmin half would otherwise walk
     * straight past, while FEATURE_CIP is off the module does not exist for
     * anyone, administrators included.
     */
    public static function canAssign(?User $user): bool
    {
        return $user !== null
            && CipAccess::enabled()
            && (Role::isAdmin($user) || CipAccess::can($user, 'cip.assign'));
    }

    /**
     * Is this account an officer who may hold a filed application?
     *
     * Uses {@see Role::of} so legacy "Reviewing Officer" / "Compliance Officer"
     * spellings still count. Administrators are deliberately out: filing on
     * somebody's behalf is routing work, not claiming it.
     */
    public static function isFilingOfficer(?User $user): bool
    {
        return $user !== null
            && $user->status === User::STATUS_APPROVED
            && in_array(Role::of($user), Role::OFFICERS, true);
    }

    /**
     * Open the hub surfaces that go with holding a file: the client's
     * Assigned list (what section 8's column draws) and the provider firm
     * (company-only, so the officer can chase documents without inheriting
     * the firm's whole book).
     *
     * The CIP assignment itself is still {@see assign}; this is the half the
     * picker and Intake must both write or the column and the Assigned tab
     * drift apart.
     */
    public static function grantHubAccess(
        CipApplication $application,
        User $officer,
        User $actor,
        string $role = CipAccess::REVIEWING_OFFICER,
    ): void {
        $application->loadMissing(['client', 'provider.company']);

        $client = $application->client;
        if ($client) {
            ClientAssignments::assign($client, $officer, [
                'role' => $role,
                'level' => 'editor',
            ], $actor, announce: false);
        }

        $firm = $application->provider?->company;
        if ($firm && ! CompanyStaffAssignment::where('company_id', $firm->id)
            ->where('user_id', $officer->id)->live()->exists()) {
            CompanyStaffAssignment::create([
                'company_id' => $firm->id,
                'user_id' => $officer->id,
                'role' => $role,
                'permission_level' => 'view_files',
                'applies_to_clients' => CompanyStaffAssignment::SCOPE_COMPANY_ONLY,
                'status' => CompanyStaffAssignment::STATUS_ACTIVE,
                'assigned_by' => $actor->id,
                'notes' => self::AUTO_NOTE,
            ]);
        }
    }

    /**
     * An officer who files an application is already working it.
     *
     * Writes the CIP row, the client hub assignment the table column reads,
     * and the firm grant — the same three surfaces the picker writes — then
     * lets {@see assign} move NEW → Review Applications when that applies.
     * Returns null when the actor is not a filing officer (admin, provider
     * contact, client), so callers can leave those files for routing.
     */
    public static function claimFilingOfficer(
        CipApplication $application,
        User $officer,
        bool $systemStatusMove = true,
    ): ?CipApplicationAssignment {
        if (! self::isFilingOfficer($officer)) {
            return null;
        }

        $role = CipAccess::REVIEWING_OFFICER;
        self::grantHubAccess($application, $officer, $officer, $role);

        return self::assign(
            $application,
            $officer,
            $officer,
            $role,
            systemStatusMove: $systemStatusMove,
        );
    }

    /**
     * Name who is typing a draft on the Assigned To column.
     *
     * A draft is already a real row; leaving it Unassigned while created_by is
     * known makes unfinished work look like nobody's. Officers claim the same
     * three surfaces they claim on filing. Administrators are named for the
     * draft only — {@see releaseRoutingAuthor} takes that claim off when they
     * file, so the file waits in New Applications the same way a direct admin
     * filing does. Provider contacts never hold files, draft or otherwise.
     */
    public static function claimDraftAuthor(
        CipApplication $application,
        User $author,
    ): ?CipApplicationAssignment {
        if ($application->status !== Status::DRAFT || ! self::mayHold($author)) {
            return null;
        }

        $role = CipAccess::REVIEWING_OFFICER;
        self::grantHubAccess($application, $author, $author, $role);

        return self::assign($application, $author, $author, $role);
    }

    /**
     * Take a non-officer's draft hold off once the file is filed.
     *
     * Administrators are named on drafts so the table can tell who typed them.
     * Filing is the routing moment: the same person must not stay the holder of
     * a New Applications row they never meant to review
     * ({@see Intake::create} leaves admin filings unassigned). Mirrors the
     * three surfaces {@see grantHubAccess} wrote — CIP row, client hub, and
     * the auto firm grant — so the column and the Assigned tab agree.
     */
    public static function releaseRoutingAuthor(CipApplication $application, User $actor): void
    {
        if (self::isFilingOfficer($actor)) {
            return;
        }

        $held = self::live($application)->firstWhere('user_id', $actor->id);
        if (! $held) {
            return;
        }

        self::end($held, $actor);

        $application->loadMissing(['client', 'provider.company']);

        $client = $application->client;
        if ($client) {
            $clientHeld = $client->assignments()->live()->where('user_id', $actor->id)->first();
            if ($clientHeld) {
                ClientAssignments::end($client, $clientHeld, $actor);
            }
        }

        $firm = $application->provider?->company;
        if (! $firm) {
            return;
        }

        $stillHolds = CipApplicationAssignment::query()
            ->live()
            ->where('user_id', $actor->id)
            ->whereHas(
                'application',
                fn ($q) => $q->where('provider_id', $application->provider_id),
            )
            ->exists();

        if ($stillHolds) {
            return;
        }

        CompanyStaffAssignment::where('company_id', $firm->id)
            ->where('user_id', $actor->id)
            ->where('notes', self::AUTO_NOTE)
            ->live()
            ->get()
            ->each(fn ($row) => $row->forceFill([
                'status' => CompanyStaffAssignment::STATUS_ENDED,
                'ended_at' => now(),
                'ended_by' => $actor->id,
            ])->save());
    }

    /**
     * Give the application to this officer, in this job.
     *
     * Whoever held it in the same job stops holding it, in the same
     * transaction that hands it on, so a file is never held twice or by
     * nobody. Reassignment is allowed at any point of the lifecycle (section 26) —
     * only the move out of NEW is conditional, because that one is section 10's
     * "assignment starts the review" and not a property of assignment itself.
     */
    public static function assign(
        CipApplication $application,
        User $officer,
        User $actor,
        string $role = CipAccess::REVIEWING_OFFICER,
        bool $systemStatusMove = false,
    ): CipApplicationAssignment {
        $held = self::live($application)->firstWhere('role', $role);

        // Handing the file to the person who already has it is not a change.
        // An inline picker that fires twice must not read, a year later, as
        // one officer losing the application and being given it back a second
        // afterwards.
        //
        // A draft claim is the exception that still needs work: the officer
        // was named while the row was DRAFT, then filing landed it at NEW
        // without a second assignment row. Section 10 still owes the move
        // into review — the hold is theirs, the review has not started.
        if ($held && $held->user_id === $officer->id) {
            if ($application->status === Status::NEW) {
                Engine::apply($application, Status::REVIEW_APPLICATION, $systemStatusMove ? null : $actor, [
                    'officer' => $officer->name,
                    'role' => $role,
                ]);
            }

            return $held;
        }

        $fromStatus = $application->status;

        $assignment = DB::transaction(function () use ($application, $officer, $actor, $role, $held, $systemStatusMove) {
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
             * Section 10 in one line: the file being assigned is what puts it into
             * review. Only from NEW, an application further down the
             * lifecycle is changing hands, and driving it back to REVIEW
             * APPLICATION to record that would throw away the reviewer's work
             * and tell every dashboard the file had started again.
             */
            if ($application->status === Status::NEW) {
                /*
                 * $systemStatusMove drives that edge as the system instead of
                 * the actor, and is for one caller: an officer filing their
                 * own application ({@see Intake::create}).
                 *
                 * cip.assign is the administrator's, so an officer cannot
                 * drive NEW -> REVIEW APPLICATION, and without this the whole
                 * filing died on a 403 from a status change nobody asked for.
                 * Nobody gains a permission: the assignment above is still
                 * recorded as the officer's own act, only the status move
                 * that automatically follows is the system's, the null actor
                 * {@see Engine::allows} already treats a scheduled job as. An
                 * officer assigning a file by hand passes false and is
                 * refused exactly as before.
                 */
                Engine::apply($application, Status::REVIEW_APPLICATION, $systemStatusMove ? null : $actor, [
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

        /*
         * NEW → REVIEW APPLICATION is announced by Engine. A file already
         * underway is only changing hands, so the four section 22 classes still hear
         * that a new officer holds it, in the filing subject for where the
         * file actually stands.
         */
        if ($fromStatus !== Status::NEW) {
            $application = $application->fresh();
            Notices::announce($application, $application->status, $actor);
        }

        return $assignment;
    }

    /**
     * Take the file off somebody.
     *
     * The status stays exactly where it is. An application between officers is
     * still under review, there is no edge back out of REVIEW APPLICATION,
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
            ->with('user:id,name,email,job_title,account_type,avatar_url,provider_avatar_url')
            ->orderBy('id')
            ->get();
    }

    /**
     * The officers this application could be handed to.
     *
     * {@see Role::OFFICERS} plus administrators. An administrator's row grants
     * no access they did not already have (see {@see ApplicationScope}), and
     * for a long time that was the reason to leave them out. It was the wrong
     * question: the column is not a list of who was let in, it is a list of
     * who is working the file. An administrator is often an employee holding
     * admin rights, and the officers and the provider side need to know they
     * are on it and can be contacted. The parked Employee type is still
     * absent, because those accounts cannot reach the portal at all, and
     * offering one would promise work to somebody who could never open it.
     * Anybody already holding the file is excluded for the plainest reason —
     * the list would be offering work that is already theirs. "Holding" is
     * the same list section 8's column draws: the client's live assignments, plus
     * the application's own when there is no client. Excluding only the CIP
     * row left an officer who was already named in the cell as a person to
     * add, which is the click that appeared to work and changed nothing.
     *
     * @return Collection<int, User>
     */
    public static function assignable(CipApplication $application): Collection
    {
        $held = self::live($application)->pluck('user_id');

        if ($application->client_id) {
            $held = $held->merge(
                ClientAssignment::live()
                    ->where('client_id', $application->client_id)
                    ->pluck('user_id')
            );
        }

        return User::query()
            // The same rule {@see mayHold} applies to one person.
            ->whereIn('account_type', [...Role::OFFICERS, Role::ADMINISTRATOR])
            ->where('status', User::STATUS_APPROVED)
            ->whereNotIn('id', $held->unique()->all())
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'avatar_url', 'provider_avatar_url', 'account_type', 'job_title']);
    }

    /**
     * May this account hold a file at all?
     *
     * The account-type half of {@see assignable}, asked of one person instead
     * of queried over everybody, so the two cannot drift into two answers to
     * the same question. Holding a file is a job, and only an approved officer
     * or administrator has it: a service provider contact and a private client
     * file applications but never carry them, and a suspended account must not
     * be handed work it cannot open.
     */
    public static function mayHold(?User $user): bool
    {
        return $user !== null
            && $user->status === User::STATUS_APPROVED
            && in_array($user->account_type, [...Role::OFFICERS, Role::ADMINISTRATOR], true);
    }

    public static function roleLabel(?string $role): string
    {
        return self::ROLES[$role] ?? 'Officer';
    }

    /**
     * Put the cache column back in step with the table that owns the answer.
     *
     * assigned_officer_id is written here and nowhere else. The reviewing
     * officer wins when a file is held in both jobs, because section 8's column asks
     * who is working it; a file nobody holds reads null rather than keeping
     * the last person who did.
     */
    /**
     * Bring `cip_applications.assigned_officer_id` back into step.
     *
     * Public because this class is not the only thing that ends an assignment:
     * suspending an account ends every file it holds (see AccessSync), and
     * without this the row would say nobody holds the file while the cache
     * went on naming the suspended officer, and every screen reads the cache.
     */
    public static function refreshCache(CipApplication $application): void
    {
        $live = self::live($application);
        $holder = $live->firstWhere('role', CipAccess::REVIEWING_OFFICER) ?? $live->first();

        $application->forceFill(['assigned_officer_id' => $holder?->user_id])->save();
    }
}
