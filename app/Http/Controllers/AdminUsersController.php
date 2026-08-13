<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\FileLibrarySetting;
use App\Models\Invitation;
use App\Models\Notification;
use App\Models\User;
use App\Models\WorkDay;
use App\Support\Access\AccessSync;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\AvatarService;
use App\Support\DeviceName;
use App\Support\Files\FolderProvisioner;
use App\Support\Invitations\Invitations;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Presence\LastSeen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AdminUsersController extends Controller
{
    // Role::ALL, spelled out where the Users page reads it: the two CIP
    // officer types are employees with a narrower CIP remit, assignable from
    // the same dropdown as everything else.
    public const ACCOUNT_TYPES = Role::ALL;

    public function index(Request $request): JsonResponse
    {
        // The account-management table: every account's status, sign-in
        // history and the controls to approve, suspend, reset and delete.
        // Administrators only. Employees browse colleagues through the People
        // section instead (`directory.view`), which carries no such controls.
        $viewer = $request->user();
        abort_unless(
            Role::can($viewer, 'users.view'),
            403,
            'Only administrators can view the account directory.'
        );

        $lastSeen = DB::table('sessions')
            ->select('user_id', DB::raw('MAX(last_activity) as last_activity'))
            ->whereNotNull('user_id')
            ->groupBy('user_id')
            ->pluck('last_activity', 'user_id');

        $userModels = User::orderByDesc('created_at')->get();
        $workStatuses = WorkDay::publicStatusesForUsers($userModels);

        $users = $userModels->map(fn (User $user) => [
            'id' => $user->id,
            'name' => $user->name,
            'firstName' => $user->first_name,
            'middleName' => $user->middle_name,
            'lastName' => $user->last_name,
            'gender' => $user->gender,
            'email' => $user->email,
            'accountType' => $user->account_type,
            'avatar' => $user->avatar_url,
            'phone' => $user->phone,
            'jobTitle' => $user->job_title,
            'bio' => $user->bio,
            'linkedin' => $user->linkedin_url,
            'profileDone' => $user->profile_completed_at !== null,
            'note' => $user->admin_note,
            'status' => $user->status,
            'twoFactor' => $user->hasTwoFactorEnabled(),
            'joined' => $user->created_at->format('M j, Y'),
            'joinedIso' => $user->created_at->toIso8601String(),
            'lastActive' => isset($lastSeen[$user->id])
                ? LastSeen::short(now()->setTimestamp($lastSeen[$user->id]), $viewer)
                : null,
            'lastActiveLabel' => isset($lastSeen[$user->id])
                ? LastSeen::label(now()->setTimestamp($lastSeen[$user->id]), $viewer)
                : null,
            'lastActiveAt' => isset($lastSeen[$user->id])
                ? now()->setTimestamp($lastSeen[$user->id])->toIso8601String()
                : null,
            'workStatus' => $workStatuses[(int) $user->id] ?? null,
            'self' => $user->id === $viewer->id,
        ]);

        return response()->json([
            'accountTypes' => self::ACCOUNT_TYPES,
            'users' => $users,
            'canManage' => $this->isAdmin($viewer),
        ]);
    }

    public function bulkDestroy(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can delete users.');

        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1'],
            'ids.*' => ['integer'],
        ]);

        // Never delete yourself, even if selected.
        $selfIncluded = in_array($request->user()->id, $data['ids'], true);
        $ids = array_values(array_diff($data['ids'], [$request->user()->id]));

        if (empty($ids)) {
            return response()->json(['deleted' => 0, 'skippedSelf' => $selfIncluded]);
        }

        // Refuse if the batch would leave no active administrator.
        $deletingAdmins = User::whereIn('id', $ids)->where('account_type', 'Administrator')->exists();
        if ($deletingAdmins) {
            $remaining = User::where('account_type', 'Administrator')
                ->where('status', 'approved')
                ->whereNotIn('id', $ids)
                ->exists();
            abort_unless($remaining, 422, 'That would remove the last administrator. Keep at least one active admin.');
        }

        $deleted = 0;
        foreach (User::whereIn('id', $ids)->get() as $user) {
            $this->moveToRecycleBin($user, $request->user());
            $deleted++;
        }

        return response()->json(['deleted' => $deleted, 'skippedSelf' => $selfIncluded]);
    }

    public function pendingCount(Request $request): JsonResponse
    {
        $count = $this->isAdmin($request->user())
            ? User::where('status', 'pending')->count()
            : 0;

        return response()->json(['count' => $count]);
    }

    /**
     * Invite someone to the portal.
     *
     * This used to create a live, approved account immediately and email a
     * password-reset link, which meant the user directory filled with accounts
     * belonging to people who had never accepted — with no way to see that, to
     * chase it, or to withdraw it. It now issues a real Invitation: no account
     * exists until the invitation is accepted.
     */
    public function store(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can invite users.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'account_type' => ['required', Rule::in(self::ACCOUNT_TYPES)],
            'phone' => ['nullable', 'string', 'max:32'],
            'job_title' => ['nullable', 'string', 'max:120'],
            'department' => ['nullable', 'string', 'max:120'],
        ], [
            'email.unique' => 'That email address already has an account.',
        ]);

        $email = Str::lower($data['email']);

        $duplicate = Invitation::query()
            ->where('email', $email)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->exists();

        abort_if($duplicate, 422, 'There is already a pending invitation for this address.');

        [$invitation] = Invitations::issue([
            'type' => $data['account_type'] === Role::CLIENT
                ? Invitation::TYPE_CLIENT
                : Invitation::TYPE_STAFF,
            'email' => $email,
            'name' => $data['name'],
            'role' => $data['account_type'],
            'access' => array_filter([
                'jobTitle' => $data['job_title'] ?? null,
                'department' => $data['department'] ?? null,
                'phone' => $data['phone'] ?? null,
            ]),
            'invited_by' => $request->user()->id,
        ]);

        Invitations::send($invitation);

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'user.invited',
            'description' => $request->user()->name.' invited '.$email.' as '.$data['account_type'],
            'subject' => $invitation,
            'metadata' => [
                'invitationId' => $invitation->uuid,
                'role' => $data['account_type'],
                'action' => 'sent',
            ],
        ]);

        return response()->json([
            'status' => 'ok',
            'invitation' => Invitations::toRecord($invitation->fresh()),
        ]);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can edit users.');

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'middle_name' => ['nullable', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'gender' => ['nullable', Rule::in(['Female', 'Male', 'Non-binary', 'Prefer not to say'])],
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users')->ignore($user->id)],
            'account_type' => ['nullable', Rule::in(self::ACCOUNT_TYPES)],
            'note' => ['nullable', 'string', 'max:2000'],
            'avatar_photo' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'phone' => ['nullable', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{7,32}$/'],
            'job_title' => ['nullable', 'string', 'max:120'],
            'bio' => ['nullable', 'string', 'max:1000'],
            'linkedin_url' => ['nullable', 'string', 'max:255', 'regex:/^(https:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+/i'],
        ], [
            'phone.regex' => 'Enter a phone number, like +1 555 123 4567.',
            'linkedin_url.regex' => 'Enter a LinkedIn profile address, like linkedin.com/in/their-name.',
        ]);

        // Demoting an administrator must never leave the portal without one.
        if (
            Role::isAdmin($user)
            && ($data['account_type'] ?? null)
            && $data['account_type'] !== 'Administrator'
        ) {
            $otherAdmins = User::where('account_type', 'Administrator')
                ->where('status', 'approved')
                ->where('id', '!=', $user->id)
                ->exists();
            abort_unless($otherAdmins, 422, 'The portal needs at least one active administrator.');
        }

        $fill = [
            'first_name' => $data['first_name'],
            'middle_name' => $data['middle_name'] ?? null,
            'last_name' => $data['last_name'],
            'gender' => $data['gender'] ?? null,
        ];
        $newEmail = Str::lower($data['email']);
        if ($newEmail !== $user->email) {
            // Admin-changed addresses are treated as vouched-for, like invites.
            $fill['email'] = $newEmail;
            $fill['email_verified_at'] = now();
        }
        if ($request->has('note')) {
            $fill['admin_note'] = $data['note'] ?? '';
        }
        if ($data['account_type'] ?? null) {
            $fill['account_type'] = $data['account_type'];
        }
        if ($request->hasFile('avatar_photo')) {
            $fill['avatar_url'] = AvatarService::storeUploaded($request->file('avatar_photo'), $user->avatar_url);
        }
        foreach (['phone', 'job_title', 'bio', 'linkedin_url'] as $field) {
            if ($request->has($field)) {
                $fill[$field] = $data[$field] ?: null;
            }
        }
        if (! empty($fill['linkedin_url']) && ! str_starts_with($fill['linkedin_url'], 'http')) {
            $fill['linkedin_url'] = 'https://'.$fill['linkedin_url'];
        }
        $user->forceFill($fill);
        $user->syncDisplayName();
        $user->save();

        $this->record($user->id, 'account_updated');

        return response()->json(['status' => 'ok']);
    }

    public function sendReset(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can send reset links.');

        Password::broker()->sendResetLink(['email' => $user->email]);

        $this->record($user->id, 'password_reset_link_sent');

        return response()->json(['status' => 'ok']);
    }

    public function generatePassword(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can generate passwords.');

        $password = Str::password(16);

        // password_auto marks it as a temporary credential the user should
        // replace; their other sessions end immediately.
        $user->forceFill([
            'password' => bcrypt($password),
            'password_auto' => true,
        ])->save();

        DB::table('sessions')->where('user_id', $user->id)->delete();

        $this->record($user->id, 'password_generated');

        return response()->json(['password' => $password]);
    }

    public function activity(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can view user activity.');

        // 'login' = sign-in history; 'app' = account & application events.
        $loginEvents = ['login', 'logout', 'login_failed', 'lockout'];

        $events = AuthEvent::where('user_id', $user->id)
            ->when($request->query('type') === 'login', fn ($q) => $q->whereIn('event', $loginEvents))
            ->when($request->query('type') === 'app', fn ($q) => $q->whereNotIn('event', $loginEvents))
            ->orderByDesc('created_at')
            ->limit(30)
            ->get()
            ->map(fn (AuthEvent $event) => [
                'event' => $event->event,
                'when' => $event->created_at->diffForHumans(),
                'atIso' => $event->created_at->toIso8601String(),
                'ip' => $event->ip,
                'device' => DeviceName::describe((string) $event->user_agent),
            ]);

        $lastLogin = AuthEvent::where('user_id', $user->id)
            ->where('event', 'login')
            ->orderByDesc('created_at')
            ->first();

        return response()->json([
            'lastLogin' => $lastLogin?->created_at->diffForHumans(),
            'events' => $events,
        ]);
    }

    public function approve(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can approve users.');

        $data = $request->validate([
            'account_type' => ['required', Rule::in(self::ACCOUNT_TYPES)],
        ]);

        abort_unless($user->status === 'pending', 422, 'Only pending accounts can be approved.');

        $user->forceFill([
            'status' => 'approved',
            'account_type' => $data['account_type'],
            'approved_at' => now(),
            'approved_by' => $request->user()->id,
        ])->save();

        $this->record($user->id, 'account_approved');
        $this->maybeProvisionStaffFolder($user->fresh(), $request->user());

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'account.approved',
            'module' => 'account',
            'description' => $request->user()->name.' approved '.$user->name.'’s account',
            'subject' => $user,
            'new' => ['account_type' => $user->account_type],
        ]);
        Notifier::send([
            'user' => $user,
            'actor' => $request->user(),
            'type' => 'account.approved',
            'title' => 'Your account has been approved',
            'message' => 'Welcome to the portal — you now have full access.',
            'action_url' => '/',
            // The welcome postcard below is the email for this moment.
            'email' => false,
        ]);
        // Inline, and tracked: a queued approval email is indistinguishable
        // from no approval email at all when no worker is draining the queue,
        // and this is the one message the account has been waiting on.
        Deliveries::send(
            Postcards::welcome($user->email, url('/'), $user->first_name ?: null),
            $user->email,
            $user,
            'welcome',
            immediate: true,
        );
        $this->clearPendingApprovalNotifications($user);

        return response()->json(['status' => 'ok']);
    }

    /**
     * Deny a pending account (§18). The request is refused, the reason is
     * recorded, the user is notified, and it drops out of the pending count and
     * the administrators' outstanding approval notifications.
     */
    public function deny(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can deny accounts.');
        abort_unless($user->status === 'pending', 422, 'Only pending accounts can be denied.');

        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $user->forceFill([
            'status' => 'suspended',
            'admin_note' => $data['reason'] ?? $user->admin_note,
        ])->save();
        DB::table('sessions')->where('user_id', $user->id)->delete();

        $this->record($user->id, 'account_denied');
        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'account.denied',
            'module' => 'account',
            'description' => $request->user()->name.' denied '.$user->name.'’s access request',
            'subject' => $user,
            'metadata' => ['reason' => $data['reason'] ?? null],
        ]);
        Notifier::send([
            'user' => $user,
            'actor' => $request->user(),
            'type' => 'account.denied',
            'title' => 'Your access request was declined',
            'message' => $data['reason'] ?? null,
            // The denial postcard below is the email for this moment.
            'email' => false,
        ]);
        // A denied account can never sign in, so the in-portal notification
        // above is one nobody will ever see. Email is the only way the decision
        // reaches them.
        Deliveries::send(
            Postcards::accountDenied($user->first_name ?: null, $data['reason'] ?? null),
            $user->email,
            $user,
            'accountDenied',
            immediate: true,
        );
        $this->clearPendingApprovalNotifications($user);

        return response()->json(['status' => 'ok']);
    }

    /**
     * Once an account is approved or denied, every administrator's outstanding
     * "needs approval" notification for it is completed and marked read, so it
     * stops showing as an action still to do — and can't be processed twice.
     */
    private function clearPendingApprovalNotifications(User $subject): void
    {
        Notification::where('type', 'account.pending')
            ->where('subject_type', $subject->getMorphClass())
            ->where('subject_id', $subject->id)
            ->whereNull('completed_at')
            ->update(['completed_at' => now(), 'read_at' => now()]);
    }

    /** Give a newly active staff member a personal folder, if configured. */
    private function maybeProvisionStaffFolder(User $user, User $actor): void
    {
        if (Role::isStaff($user)
            && FileLibrarySetting::autoCreateStaffFolder()) {
            FolderProvisioner::provisionStaffFolder($user, $actor);
        }
    }

    public function suspend(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can suspend users.');
        abort_if($user->id === $request->user()->id, 422, "You can't suspend your own account.");

        if ($user->account_type === 'Administrator') {
            $otherAdmins = User::where('account_type', 'Administrator')
                ->where('status', 'approved')
                ->where('id', '!=', $user->id)
                ->exists();
            abort_unless($otherAdmins, 422, 'The portal needs at least one active administrator.');
        }

        $user->forceFill(['status' => 'suspended'])->save();

        // End their sessions immediately.
        DB::table('sessions')->where('user_id', $user->id)->delete();

        // …and every grant that hangs off the account. Ending the session only
        // stops the current visit; the assignments would still be waiting.
        AccessSync::userSuspended($user, $request->user());

        $this->record($user->id, 'account_suspended');

        return response()->json(['status' => 'ok']);
    }

    public function resetTwoFactor(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can reset two-factor authentication.');
        abort_unless($user->two_factor_secret !== null, 422, 'Two-factor authentication is not set up for this account.');

        // Lockout recovery: the user signs in with just their password and
        // can enroll a new authenticator afterwards.
        $user->forceFill([
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
        ])->save();

        $this->record($user->id, 'two_factor_reset');

        return response()->json(['status' => 'ok']);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can delete users.');
        abort_if($user->id === $request->user()->id, 422, "You can't delete your own account.");

        if ($user->account_type === 'Administrator') {
            $otherAdmins = User::where('account_type', 'Administrator')
                ->where('status', 'approved')
                ->where('id', '!=', $user->id)
                ->exists();
            abort_unless($otherAdmins, 422, 'The portal needs at least one active administrator.');
        }

        $this->moveToRecycleBin($user, $request->user());

        return response()->json(['status' => 'ok']);
    }

    /**
     * Deleting an account parks it in the admin Recycle Bin rather than erasing
     * it. The row survives, so nothing keyed to the user cascades away and a
     * restore brings the whole account back.
     *
     * What does *not* survive is the ability to act: sessions are dropped, and
     * live client/company assignments are settled exactly as they are on a
     * suspension. Those are ended rather than deleted, so restoring an account
     * is a deliberate re-assignment rather than a silent return of everything
     * the person could once reach.
     *
     * System folders stay put — see SystemFolders::rehome, which runs on purge
     * instead, when the row really is about to go.
     */
    private function moveToRecycleBin(User $user, User $actor): void
    {
        $this->record($user->id, 'account_deleted');

        DB::table('sessions')->where('user_id', $user->id)->delete();
        AccessSync::userSuspended($user, $actor);

        $user->forceFill(['deleted_by' => $actor->id])->save();
        $user->delete();

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'account.deleted',
            'module' => 'account',
            'description' => $actor->name.' moved the account for '.$user->email.' to the Recycle Bin',
            'subject' => $user,
        ]);
    }

    public function reactivate(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can reactivate users.');
        abort_unless($user->status === 'suspended', 422, 'Only suspended accounts can be reactivated.');

        $user->forceFill(['status' => 'approved'])->save();

        $this->record($user->id, 'account_reactivated');

        return response()->json(['status' => 'ok']);
    }

    private function isAdmin(User $user): bool
    {
        return Role::can($user, 'users.manage');
    }

    private function record(int $userId, string $event): void
    {
        AuthEvent::create([
            'user_id' => $userId,
            'event' => $event,
            'ip' => request()->ip(),
            'user_agent' => (string) request()->userAgent(),
            'created_at' => now(),
        ]);
    }
}
