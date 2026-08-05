<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\Client;
use App\Models\Contact;
use App\Models\Group;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Invitations\Invitations;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * The People section (People → Manage users, Browse employees, Browse client
 * contacts, Browse prospects, Resend welcome emails).
 *
 * These screens read the real directory rather than keeping their own list:
 * employees and client contacts are `users` rows, and a prospect is someone
 * who has been invited but has not signed in yet — either a live `invitations`
 * row or an account that still holds the automatic password
 * it was created with. Writes are deliberately not duplicated here: creating,
 * editing and deleting accounts stays in {@see AdminUsersController}, so there
 * is one place where those rules live.
 */
class PeopleController extends Controller
{
    /** Employees + client contacts are listed in whole; the portal is one firm. */
    private const MAX_ROWS = 2000;

    /* ── screens ──────────────────────────────────────────────────── */

    /** People → Manage users: the counts behind the section's home cards. */
    public function summary(Request $request): JsonResponse
    {
        $user = $this->authorizeView($request);

        $byType = User::query()
            ->selectRaw('account_type, count(*) as aggregate')
            ->groupBy('account_type')
            ->pluck('aggregate', 'account_type');

        $employees = (int) ($byType[Role::EMPLOYEE] ?? 0) + (int) ($byType[Role::ADMINISTRATOR] ?? 0);

        return response()->json([
            'counts' => [
                'employees' => $employees,
                'clientContacts' => (int) ($byType[Role::CLIENT] ?? 0),
                'prospects' => $this->prospectRecords()->count(),
                'sharedContacts' => Contact::where('scope', Contact::SCOPE_SHARED)->count(),
                'personalContacts' => Contact::where('scope', Contact::SCOPE_PERSONAL)
                    ->where('owner_id', $user->id)->count(),
                'groups' => Role::can($user, 'groups.view')
                    ? Group::where('is_archived', false)->count()
                    : 0,
            ],
            'capabilities' => $this->capabilities($user),
        ]);
    }

    /** People → Browse employees: everyone who works here. */
    public function employees(Request $request): JsonResponse
    {
        $user = $this->authorizeView($request);

        $employees = User::query()
            ->whereIn('account_type', Role::STAFF)
            ->orderBy('last_name')
            ->orderBy('name')
            ->limit(self::MAX_ROWS)
            ->get();

        return response()->json([
            'employees' => $this->people($employees, $user),
            'capabilities' => $this->capabilities($user),
            'accountTypes' => AdminUsersController::ACCOUNT_TYPES,
        ]);
    }

    /**
     * People → Browse client contacts: the client accounts that can sign in.
     * The client *directory* (companies, files, assignments) is the Clients
     * hub; this screen is only about the people holding a login.
     */
    public function clientContacts(Request $request): JsonResponse
    {
        $user = $this->authorizeView($request);
        abort_unless(Role::can($user, 'clients.view'), 403, 'Only staff can browse client contacts.');

        $clients = User::query()
            ->where('account_type', Role::CLIENT)
            ->orderBy('last_name')
            ->orderBy('name')
            ->limit(self::MAX_ROWS)
            ->get();

        // A client account may be linked to a client record, which is where
        // the company name lives.
        $records = Client::whereIn('user_id', $clients->pluck('id'))
            ->get(['user_id', 'uid', 'company'])
            ->keyBy('user_id');

        $rows = $this->people($clients, $user)->map(function (array $row) use ($records) {
            $record = $records[$row['id']] ?? null;
            $row['company'] = $record?->company;
            $row['clientUid'] = $record?->uid;

            return $row;
        });

        return response()->json([
            'contacts' => $rows->values(),
            'capabilities' => $this->capabilities($user),
        ]);
    }

    /**
     * People → Browse prospects: invited, not yet activated. Two sources, one
     * list — a client invited from the Clients hub who has not accepted, and
     * an account created for someone who has never signed in.
     */
    public function prospects(Request $request): JsonResponse
    {
        $user = $this->authorizeView($request);

        // `status` turns this screen into the full invitation management area:
        // by default it answers its original question ("who hasn't activated?"),
        // and a status filter opens up the accepted, expired, failed and
        // cancelled invitations that used to be invisible here.
        $status = (string) $request->query('status', 'waiting');

        return response()->json([
            'prospects' => $this->prospectRecords($status)->values(),
            'counts' => $this->invitationCounts(),
            'capabilities' => $this->capabilities($user),
        ]);
    }

    /** How many invitations sit in each state, for the filter chips. */
    private function invitationCounts(): array
    {
        $rows = Invitation::query()
            ->selectRaw('status, count(*) as total')
            ->groupBy('status')
            ->pluck('total', 'status');

        $n = fn (string $k) => (int) ($rows[$k] ?? 0);

        // Counted the same way the filters select, so a chip never disagrees
        // with the list it opens.
        $lapsed = Invitation::query()
            ->whereNull('accepted_at')->whereNull('cancelled_at')
            ->whereNotNull('expires_at')->where('expires_at', '<', now())
            ->count();

        $live = Invitation::query()
            ->whereNull('accepted_at')->whereNull('cancelled_at')
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>=', now()))
            ->count();

        return [
            'waiting' => $live,
            'accepted' => $n('accepted'),
            'expired' => $lapsed + $n('expired'),
            'failed' => $n('failed'),
            'cancelled' => $n('cancelled'),
        ];
    }

    /**
     * People → Resend welcome emails: who is still waiting on one. The same
     * set as prospects, so the screen can offer a list instead of asking
     * someone to retype an address.
     */
    public function welcomeCandidates(Request $request): JsonResponse
    {
        $this->authorizeManage($request);

        return response()->json(['candidates' => $this->prospectRecords()->values()]);
    }

    /* ── actions ──────────────────────────────────────────────────── */

    /**
     * Re-send the email that gets someone into the portal.
     *
     * Which email that is depends on where they are: an account that never set
     * a password gets the activation (reset) link, because a welcome note it
     * cannot act on is useless; an active account gets the welcome postcard.
     * Addresses that belong to neither are refused — this screen re-invites
     * people who are already in the account, it is not a way to email
     * strangers.
     */
    public function sendWelcome(Request $request): JsonResponse
    {
        $actor = $this->authorizeManage($request);

        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
            'message' => ['nullable', 'string', 'max:1000'],
            'copyToMe' => ['nullable', 'boolean'],
        ]);

        $email = Str::lower($data['email']);
        $note = $data['message'] ?? null;

        $user = User::where('email', $email)->first();
        $invite = $user ? null : Invitation::query()
            ->whereRaw('LOWER(email) = ?', [$email])
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->latest('id')
            ->first();

        abort_if(
            ! $user && ! $invite,
            422,
            'No account or pending invitation uses that address. Add them first, then send the welcome email.'
        );

        if ($invite) {
            $sent = $this->resendInvite($invite, $actor);
        } else {
            $sent = $this->resendForUser($user, $actor, $note);
        }

        if ($request->boolean('copyToMe')) {
            Deliveries::send(
                Postcards::welcome($email, url('/'), $actor->first_name ?: null, $note),
                $actor->email,
                $actor,
                'welcome',
                immediate: true,
            );
        }

        return response()->json(['status' => 'ok', 'kind' => $sent]);
    }

    /**
     * Withdraw a prospect: cancel the pending invitation, or delete the
     * never-used account that was created for them.
     */
    public function destroyProspect(Request $request, string $ref): JsonResponse
    {
        $actor = $this->authorizeManage($request);

        [$kind, $id] = array_pad(explode(':', $ref, 2), 2, null);
        abort_unless($id !== null && ctype_digit((string) $id), 404);

        if ($kind === 'invite') {
            $invite = Invitation::whereNull('accepted_at')->findOrFail((int) $id);

            // Cancelled rather than deleted: withdrawing an invitation is a
            // thing that happened, and the management screen has to be able to
            // show that it did.
            Invitations::cancel($invite, $actor);

            return response()->json(['status' => 'ok']);
        }

        abort_unless($kind === 'user', 404);

        $user = User::findOrFail((int) $id);
        // Only ever the accounts this screen actually lists: someone who has
        // never signed in. An active colleague is deleted from Browse
        // employees, with all the safety checks that carries.
        abort_unless($this->hasNeverSignedIn($user), 422, 'That account has already been used. Remove it from Browse employees instead.');
        abort_if($user->id === $actor->id, 422, "You can't remove your own account.");

        DB::table('sessions')->where('user_id', $user->id)->delete();

        // Erased, not parked in the Recycle Bin. This is the withdrawal of an
        // invitation that was never taken up: the shell account holds nothing
        // worth restoring, and leaving it soft-deleted would hold its email
        // address hostage against the unique index if the person is re-invited.
        $user->forceDelete();

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'account.deleted',
            'module' => 'account',
            'description' => $actor->name.' removed the unused account for '.$user->email,
        ]);

        return response()->json(['status' => 'ok']);
    }

    /* ── shared shapes ────────────────────────────────────────────── */

    /**
     * The row shape both people lists render: who they are, whether they can
     * actually get in, and when they were last here.
     *
     * @param  EloquentCollection<int, User>  $users
     * @return Collection<int, array<string, mixed>>
     */
    private function people(EloquentCollection $users, User $viewer): Collection
    {
        $ids = $users->pluck('id');

        $lastLogin = AuthEvent::whereIn('user_id', $ids)
            ->where('event', 'login')
            ->selectRaw('user_id, MAX(created_at) as at')
            ->groupBy('user_id')
            ->pluck('at', 'user_id');

        $lastSeen = DB::table('sessions')
            ->whereIn('user_id', $ids)
            ->selectRaw('user_id, MAX(last_activity) as last_activity')
            ->groupBy('user_id')
            ->pluck('last_activity', 'user_id');

        return $users->map(function (User $u) use ($lastLogin, $lastSeen, $viewer) {
            $at = $lastLogin[$u->id] ?? null;
            $signedIn = $at !== null;

            return [
                'id' => $u->id,
                'name' => $u->name,
                'firstName' => $u->first_name,
                'lastName' => $u->last_name,
                'email' => $u->email,
                'accountType' => $u->account_type,
                'admin' => $u->account_type === Role::ADMINISTRATOR,
                'jobTitle' => $u->job_title,
                'phone' => $u->phone,
                'avatar' => $u->photoUrl(),
                'status' => $u->status,
                // "Not activated" is the state the Showing filter asks about:
                // the account exists but nobody has ever signed in with it.
                'activated' => $signedIn && $u->status === User::STATUS_APPROVED,
                'lastLogin' => $at ? $this->humanTime($at) : null,
                'lastActive' => isset($lastSeen[$u->id])
                    ? now()->setTimestamp((int) $lastSeen[$u->id])->diffForHumans()
                    : null,
                'joined' => $u->created_at?->format('M j, Y'),
                'self' => $u->id === $viewer->id,
            ];
        })->values();
    }

    /**
     * Everyone who has been asked to join and hasn't: pending client
     * invitations, plus accounts that have never been signed in to.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function prospectRecords(string $status = 'waiting'): Collection
    {
        $query = Invitation::query()
            ->with(['client:id,name,company,email', 'inviter:id,name'])
            ->orderByDesc('id');

        // `waiting` is this screen's original question: still outstanding.
        // Everything else asks for one settled state.
        // Expiry is a date, not an event: an invitation lapses without anything
        // running, so `status` may still read `sent` on a row that is long past
        // its date. Both filters therefore ask about the date, not the column,
        // and syncExpiry() below settles the stored value afterwards.
        $lapsed = fn ($q) => $q->whereNotNull('expires_at')->where('expires_at', '<', now());
        $unsettled = fn ($q) => $q->whereNull('accepted_at')->whereNull('cancelled_at');

        match ($status) {
            'accepted' => $query->where('status', Invitation::STATUS_ACCEPTED),
            'expired' => $query->where($unsettled)->where(function ($q) use ($lapsed) {
                $q->where('status', Invitation::STATUS_EXPIRED)->orWhere($lapsed);
            }),
            'failed' => $query->where('status', Invitation::STATUS_FAILED),
            'cancelled' => $query->where('status', Invitation::STATUS_CANCELLED),
            'all' => null,
            default => $query->where($unsettled)
                ->whereIn('status', Invitation::LIVE_STATUSES)
                // A lapsed invitation is no longer "still waiting".
                ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>=', now())),
        };

        $invites = $query->get()
            ->each(fn (Invitation $i) => $i->syncExpiry())
            ->map(fn (Invitation $invite) => [
                'id' => 'invite:'.$invite->id,
                'source' => 'invite',
                'name' => $invite->name ?: $invite->client?->name ?: $invite->email,
                'email' => $invite->email,
                'company' => $invite->client?->company,
                'accountType' => $invite->role ?: Role::CLIENT,
                'invitedIso' => ($invite->last_sent_at ?? $invite->created_at)?->toIso8601String(),
                'invited' => $this->humanTime($invite->last_sent_at ?? $invite->created_at),
                'expired' => $invite->isExpired(),
                // A send that failed is the one thing this screen could never
                // show before, and it is the reason most invitations stall.
                'failed' => $invite->status === Invitation::STATUS_FAILED,
                // Everything the management area needs to act on this row.
                'invitationId' => $invite->uuid,
                'status' => $invite->status,
                'lastError' => $invite->last_error,
                'sendCount' => $invite->send_count,
                'expiresAt' => $invite->expires_at?->toIso8601String(),
                'acceptedAt' => $invite->accepted_at?->toIso8601String(),
                'cancelledAt' => $invite->cancelled_at?->toIso8601String(),
                'invitedBy' => $invite->inviter?->name,
                'canResend' => $invite->isAcceptable() || in_array(
                    $invite->status,
                    [Invitation::STATUS_EXPIRED, Invitation::STATUS_CANCELLED],
                    true,
                ),
                'canCancel' => $invite->isAcceptable(),
            ]);

        $candidates = User::query()
            ->where(function ($q) {
                $q->where('status', User::STATUS_PENDING)
                    ->orWhere('password_auto', true);
            })
            ->orderByDesc('created_at')
            ->limit(self::MAX_ROWS)
            ->get();

        // One query for the whole set, not one per candidate.
        $signedIn = AuthEvent::whereIn('user_id', $candidates->pluck('id'))
            ->where('event', 'login')
            ->distinct()
            ->pluck('user_id')
            ->all();

        $accounts = $candidates
            ->reject(fn (User $u) => in_array($u->id, $signedIn, true))
            ->map(fn (User $u) => [
                'id' => 'user:'.$u->id,
                'source' => 'user',
                'name' => $u->name,
                'email' => $u->email,
                'company' => null,
                'accountType' => $u->account_type,
                'invitedIso' => $u->created_at?->toIso8601String(),
                'invited' => $this->humanTime($u->created_at),
                'expired' => false,
                'awaitingApproval' => $u->status === User::STATUS_PENDING,
            ]);

        // The unused-account half only belongs to the outstanding view — an
        // "accepted invitations" list should not be padded with dormant logins.
        return in_array($status, ['waiting', 'all'], true)
            ? $invites->concat($accounts)->values()
            : $invites->values();
    }

    /** Never signed in: no login event has ever been recorded for them. */
    private function hasNeverSignedIn(User $user): bool
    {
        return ! AuthEvent::where('user_id', $user->id)->where('event', 'login')->exists();
    }

    private function resendInvite(Invitation $invite, User $actor): string
    {
        // A lapsed invitation is revived rather than refused — this screen
        // exists precisely to chase the ones that went cold.
        if ($invite->isExpired()) {
            $invite->forceFill([
                'status' => Invitation::STATUS_PENDING,
                'expires_at' => now()->addDays(Invitations::EXPIRY_DAYS),
            ])->save();
        }

        Invitations::send($invite, reminder: true);

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'client.invite_resent',
            'module' => 'account',
            'description' => $actor->name.' re-sent the invitation to '.$invite->email,
        ]);

        return 'invite';
    }

    private function resendForUser(User $user, User $actor, ?string $note): string
    {
        // No password of their own yet — the activation link is the only email
        // that gets them in.
        if ($user->password_auto || ! $user->hasVerifiedEmail()) {
            Password::broker()->sendResetLink(['email' => $user->email]);
            $kind = 'activation';
        } else {
            Deliveries::send(
                Postcards::welcome($user->email, url('/'), $user->first_name ?: null, $note),
                $user->email,
                $user,
                'welcome',
                immediate: true,
            );
            $kind = 'welcome';
        }

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'account.welcome_resent',
            'module' => 'account',
            'description' => $actor->name.' re-sent the '.($kind === 'activation' ? 'activation' : 'welcome').' email to '.$user->email,
            'subject' => $user,
        ]);

        return $kind;
    }

    /** @return array<string, bool> */
    private function capabilities(User $user): array
    {
        return [
            'manageUsers' => Role::can($user, 'users.manage'),
            'viewClients' => Role::can($user, 'clients.view'),
            'manageGroups' => Role::can($user, 'groups.manage'),
            'viewGroups' => Role::can($user, 'groups.view'),
        ];
    }

    private function humanTime(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return ($value instanceof \DateTimeInterface ? Carbon::instance($value) : Carbon::parse($value))
            ->diffForHumans();
    }

    private function authorizeView(Request $request): User
    {
        $user = $request->user();
        abort_unless(Role::can($user, 'directory.view'), 403, 'Only staff can browse the directory.');

        return $user;
    }

    private function authorizeManage(Request $request): User
    {
        $user = $request->user();
        abort_unless(Role::can($user, 'users.manage'), 403, 'Only administrators can do that.');

        return $user;
    }
}
