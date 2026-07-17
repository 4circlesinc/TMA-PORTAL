<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\User;
use App\Support\AvatarService;
use App\Support\DeviceName;
use App\Support\Files\FolderProvisioner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AdminUsersController extends Controller
{
    public const ACCOUNT_TYPES = ['Client', 'Employee', 'Administrator'];

    public function index(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can manage users.');

        $lastSeen = DB::table('sessions')
            ->select('user_id', DB::raw('MAX(last_activity) as last_activity'))
            ->groupBy('user_id')
            ->pluck('last_activity', 'user_id');

        $users = User::orderByDesc('created_at')->get()->map(fn (User $user) => [
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
                ? now()->setTimestamp($lastSeen[$user->id])->diffForHumans()
                : null,
            'self' => $user->id === $request->user()->id,
        ]);

        return response()->json([
            'accountTypes' => self::ACCOUNT_TYPES,
            'users' => $users,
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

        foreach (User::whereIn('id', $ids)->pluck('id') as $uid) {
            $this->record($uid, 'account_deleted');
        }
        DB::table('sessions')->whereIn('user_id', $ids)->delete();
        $this->rehomeSystemFolders($ids, $request->user()->id);
        $deleted = User::whereIn('id', $ids)->delete();

        return response()->json(['deleted' => $deleted, 'skippedSelf' => $selfIncluded]);
    }

    public function pendingCount(Request $request): JsonResponse
    {
        $count = $this->isAdmin($request->user())
            ? User::where('status', 'pending')->count()
            : 0;

        return response()->json(['count' => $count]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can invite users.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'account_type' => ['required', Rule::in(self::ACCOUNT_TYPES)],
            'phone' => ['nullable', 'string', 'max:32'],
        ]);

        $parts = preg_split('/\s+/', trim($data['name']), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $first = array_shift($parts) ?: $data['name'];
        $last = count($parts) ? array_pop($parts) : null;

        $user = new User([
            'name' => $data['name'],
            'first_name' => $first,
            'middle_name' => count($parts) ? implode(' ', $parts) : null,
            'last_name' => $last,
            'email' => Str::lower($data['email']),
            'phone' => $data['phone'] ?? null,
            'password' => Str::password(32),
        ]);
        // Invited by an admin: pre-approved, address vouched for. They set
        // their own password through the emailed invite (reset) link.
        $user->forceFill([
            'email_verified_at' => now(),
            'password_auto' => true,
            'status' => 'approved',
            'account_type' => $data['account_type'],
            'approved_at' => now(),
            'approved_by' => $request->user()->id,
        ])->save();

        Password::broker()->sendResetLink(['email' => $user->email]);

        $this->record($user->id, 'user_invited');
        $this->maybeProvisionStaffFolder($user, $request->user());

        return response()->json(['status' => 'ok']);
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
            $user->account_type === 'Administrator'
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

        return response()->json(['status' => 'ok']);
    }

    /** Give a newly active staff member a personal folder, if configured. */
    private function maybeProvisionStaffFolder(User $user, User $actor): void
    {
        if (in_array($user->account_type, ['Administrator', 'Employee'], true)
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

        $this->record($user->id, 'account_deleted');

        DB::table('sessions')->where('user_id', $user->id)->delete();
        $this->rehomeSystemFolders([$user->id], $request->user()->id);
        $user->delete();

        return response()->json(['status' => 'ok']);
    }

    /**
     * System-managed folders (the Client Files / Staff Files roots, every
     * organization / client / staff folder, and everything nested inside them)
     * are owned and created by an administrator so storage has a stable owner.
     * folders and files both cascade on those columns, so before an admin is
     * deleted we hand that whole subtree - folders and their files - to another
     * admin. Otherwise deleting an admin would destroy client and organization
     * content along with the account.
     *
     * @param  array<int, int>  $userIds
     */
    private function rehomeSystemFolders(array $userIds, int $actorId): void
    {
        $heir = User::where('account_type', 'Administrator')
            ->whereNotIn('id', $userIds)
            ->orderBy('id')
            ->value('id') ?? $actorId;

        // Seed from the structural system nodes, then walk down to every
        // descendant folder so nested subfolders and files are covered too.
        $ids = Folder::withTrashed()
            ->whereIn('folder_type', ['root', 'organization', 'client', 'staff'])
            ->pluck('id')->all();

        $frontier = $ids;
        while ($frontier) {
            $children = Folder::withTrashed()->whereIn('parent_id', $frontier)->pluck('id')->all();
            $children = array_values(array_diff($children, $ids));
            if (! $children) {
                break;
            }
            $ids = array_merge($ids, $children);
            $frontier = $children;
        }

        if (! $ids) {
            return;
        }

        Folder::withTrashed()->whereIn('id', $ids)
            ->whereIn('owner_id', $userIds)->update(['owner_id' => $heir]);
        Folder::withTrashed()->whereIn('id', $ids)
            ->whereIn('created_by', $userIds)->update(['created_by' => $heir]);

        FileItem::withTrashed()->whereIn('folder_id', $ids)
            ->whereIn('owner_id', $userIds)->update(['owner_id' => $heir]);
        FileItem::withTrashed()->whereIn('folder_id', $ids)
            ->whereIn('uploaded_by', $userIds)->update(['uploaded_by' => $heir]);
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
        return $user->account_type === 'Administrator';
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
