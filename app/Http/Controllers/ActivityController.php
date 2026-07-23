<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\User;
use App\Support\Notifications\NotificationPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The audit trail, read back for the Overview → Activity log, the right-sidebar
 * Activities section, and the Activities header popup.
 *
 * Visibility is enforced on every query through {@see ActivityLog::scopeVisibleTo}:
 * administrators see the whole firm, everyone else sees only their own actions
 * (§9, §28). IP, device, and the value diff are only serialised for viewers
 * allowed to see them.
 */
class ActivityController extends Controller
{
    private const PAGE = 25;

    /** A filtered, searchable, paginated page of the audit trail (§8, §9, §10). */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $isAdmin = $user->account_type === 'Administrator';

        $query = ActivityLog::query()
            ->with(['actor', 'client'])
            ->visibleTo($user)
            ->latestFirst();

        $this->applyFilters($query, $request, $isAdmin);

        if ($cursor = $request->query('cursor')) {
            $query->where('id', '<', (int) $cursor);
        }

        $limit = min((int) $request->query('limit', self::PAGE), 100);
        $rows = $query->limit($limit + 1)->get();

        $hasMore = $rows->count() > $limit;
        $rows = $rows->take($limit);

        return response()->json([
            'items' => $rows->map(fn (ActivityLog $log) => NotificationPresenter::activity($log, $isAdmin))->values(),
            'nextCursor' => $hasMore ? $rows->last()->id : null,
            'isAdmin' => $isAdmin,
        ]);
    }

    /**
     * The activity badge count (§12): activity new since the viewer last opened
     * the panel, plus any failures needing attention. Never "every activity".
     */
    public function count(Request $request): JsonResponse
    {
        $user = $request->user();
        $seenAt = $this->seenAt($user);

        $newQuery = ActivityLog::query()->visibleTo($user);
        if ($seenAt) {
            $newQuery->where('created_at', '>', $seenAt);
        }
        // A user's own actions are not "new activity" to review.
        if ($user->account_type === 'Administrator') {
            $newQuery->where(function ($q) use ($user) {
                $q->whereNull('actor_id')->orWhere('actor_id', '!=', $user->id);
            });
        }

        return response()->json([
            'new' => $newQuery->count(),
            'failed' => ActivityLog::query()
                ->visibleTo($user)
                ->where('status', ActivityLog::STATUS_FAILURE)
                ->when($seenAt, fn ($q) => $q->where('created_at', '>', $seenAt))
                ->count(),
        ]);
    }

    /**
     * Record that the viewer has now seen the activity panel, resetting their
     * "new since" baseline so the badge clears (§12). Stored in preferences to
     * avoid a dedicated column.
     */
    public function markSeen(Request $request): JsonResponse
    {
        $user = $request->user();
        $prefs = $user->preferences ?? [];
        $prefs['activity_seen_at'] = now()->toIso8601String();
        $user->forceFill(['preferences' => $prefs])->save();

        return response()->json(['ok' => true, 'new' => 0]);
    }

    /**
     * The filter vocabulary the admin activity view offers (§9): which modules,
     * actors, statuses and types actually appear in the visible trail.
     */
    public function filters(Request $request): JsonResponse
    {
        $user = $request->user();
        $base = fn () => ActivityLog::query()->visibleTo($user);

        return response()->json([
            'modules' => $base()->distinct()->orderBy('module')->pluck('module')->filter()->values(),
            'types' => $base()->distinct()->orderBy('activity_type')->pluck('activity_type')->filter()->values(),
            'statuses' => [ActivityLog::STATUS_SUCCESS, ActivityLog::STATUS_FAILURE, ActivityLog::STATUS_PENDING],
            'actors' => $user->account_type === 'Administrator'
                ? User::query()
                    ->whereIn('id', $base()->whereNotNull('actor_id')->distinct()->pluck('actor_id'))
                    ->orderBy('name')
                    ->get()
                    ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name])
                    ->values()
                : [],
        ]);
    }

    private function applyFilters($query, Request $request, bool $isAdmin): void
    {
        if ($module = $request->query('module')) {
            $query->where('module', $module);
        }
        if ($type = $request->query('type')) {
            $query->where('activity_type', $type);
        }
        if ($action = $request->query('action')) {
            $query->where('action', $action);
        }
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($request->boolean('system')) {
            $query->whereNull('actor_id');
        }
        // Filtering by a specific actor is an administrator capability.
        if ($isAdmin && ($actor = $request->query('actor'))) {
            $query->where('actor_id', (int) $actor);
        }
        if ($clientUid = $request->query('client')) {
            $clientId = Client::where('uid', $clientUid)->value('id');
            $query->where('client_id', $clientId);
        }
        if ($from = $request->query('from')) {
            $query->where('created_at', '>=', Carbon::parse($from)->startOfDay());
        }
        if ($to = $request->query('to')) {
            $query->where('created_at', '<=', Carbon::parse($to)->endOfDay());
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $like = '%' . $search . '%';
            $query->where(function ($q) use ($like) {
                $q->where('description', 'like', $like)
                    ->orWhere('activity_type', 'like', $like)
                    ->orWhere('module', 'like', $like)
                    ->orWhere('ip_address', 'like', $like)
                    ->orWhereHas('actor', fn ($a) => $a->where('name', 'like', $like))
                    ->orWhereHas('client', fn ($c) => $c->where('name', 'like', $like));
            });
        }
    }

    private function seenAt(User $user): ?Carbon
    {
        $iso = $user->preferences['activity_seen_at'] ?? null;

        return $iso ? Carbon::parse($iso) : null;
    }
}
