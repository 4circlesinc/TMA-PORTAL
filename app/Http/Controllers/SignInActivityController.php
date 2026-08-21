<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Support\Access\Role;
use App\Support\Notifications\NotificationPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Recent sign-ins across the firm, for the Overview card.
 *
 * This reads `auth_events` rather than the audit trail. Two reasons: failed
 * attempts and lockouts are only recorded there, and the audit trail is scoped
 * per-viewer by `activity.viewAll` — everyone but an administrator sees only
 * their own rows, which is the opposite of what a "who signed in" card is for.
 *
 * Staff-gated, not administrator-gated: employees see the firm's sign-ins too.
 * Clients never do — they have no business seeing when staff sign in, and the
 * Overview page is closed to them anyway ({@see Role::PAGE_CAPABILITIES}).
 *
 * IP and device stay out of the payload. The audit trail serialises those for
 * administrators only, and this endpoint has a wider audience; the full table,
 * with both, remains on Settings → Security for a person's own account.
 */
class SignInActivityController extends Controller
{
    private const LIMIT = 8;

    /** Sign-ins and the attempts that failed — not sign-outs, which double the noise. */
    private const EVENTS = ['login', 'login_failed', 'lockout', 'social_failed'];

    public function __invoke(Request $request): JsonResponse
    {
        Role::authorizeStaff($request->user());

        $limit = min(max((int) $request->query('limit', self::LIMIT), 1), 50);

        $events = AuthEvent::with('user')
            ->whereIn('event', self::EVENTS)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get();

        return response()->json([
            'items' => $events->map(fn (AuthEvent $event) => [
                'id' => 'auth-'.$event->id,
                'module' => 'security',
                'type' => 'security.'.$event->event,
                'status' => $event->event === 'login' ? 'success' : 'failure',
                'description' => $this->describe($event),
                'actor' => NotificationPresenter::actor($event->user),
                'createdAt' => $event->created_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    /**
     * A failed attempt often has no user at all — Laravel's Failed event fires
     * for an address that matches nobody — so nothing here may assume one.
     */
    private function describe(AuthEvent $event): string
    {
        $name = $event->user?->name;

        return match ($event->event) {
            'login' => $name ? $name.' signed in' : 'Someone signed in',
            'lockout' => $name
                ? $name.' was locked out after too many attempts'
                : 'An account was locked out after too many attempts',
            // Refused by Microsoft or Google, not by us — usually the person's
            // own tenant. Naming it as a plain failed sign-in would send
            // whoever reads this card looking at the wrong thing entirely.
            'social_failed' => $name
                ? 'Microsoft or Google sign-in was refused for '.$name
                : 'A Microsoft or Google sign-in was refused',
            default => $name ? 'Failed sign-in for '.$name : 'Failed sign-in attempt',
        };
    }
}
