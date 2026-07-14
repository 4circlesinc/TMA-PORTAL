<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\User;
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
            'email' => $user->email,
            'accountType' => $user->account_type,
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

    public function store(Request $request): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can invite users.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'account_type' => ['required', Rule::in(self::ACCOUNT_TYPES)],
        ]);

        $user = new User([
            'name' => $data['name'],
            'email' => Str::lower($data['email']),
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

        return response()->json(['status' => 'ok']);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        abort_unless($this->isAdmin($request->user()), 403, 'Only administrators can edit users.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'account_type' => ['nullable', Rule::in(self::ACCOUNT_TYPES)],
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

        $user->forceFill(array_filter([
            'name' => $data['name'],
            'account_type' => $data['account_type'] ?? null,
        ]))->save();

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

        $events = AuthEvent::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(30)
            ->get()
            ->map(fn (AuthEvent $event) => [
                'event' => $event->event,
                'when' => $event->created_at->diffForHumans(),
                'atIso' => $event->created_at->toIso8601String(),
                'ip' => $event->ip,
                'device' => \App\Support\DeviceName::describe((string) $event->user_agent),
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

        return response()->json(['status' => 'ok']);
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
