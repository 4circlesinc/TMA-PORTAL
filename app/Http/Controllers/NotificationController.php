<?php

namespace App\Http\Controllers;

use App\Models\Notification;
use App\Support\Notifications\NotificationPreferences;
use App\Support\Notifications\NotificationPresenter;
use App\Support\Notifications\NotificationType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The signed-in user's own notifications: the bell popup, the right-sidebar
 * Notifications section, and the full list all read from here. Every query is
 * scoped to the caller — a user can only ever see, read, or delete their own
 * rows (§28).
 */
class NotificationController extends Controller
{
    private const PAGE = 20;

    /** A page of the caller's notifications, newest first, with filters (§20, §26). */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $query = Notification::query()
            ->with('actor')
            ->forUser($user)
            ->latestFirst();

        if ($request->boolean('unread')) {
            $query->unread();
        }
        if ($request->boolean('actionRequired')) {
            $query->whereIn('level', [Notification::LEVEL_ACTION, Notification::LEVEL_APPROVAL])
                ->whereNull('completed_at');
        }
        if ($module = $request->query('module')) {
            $query->where('module', $module);
        }
        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }
        if ($level = $request->query('level')) {
            $query->where('level', $level);
        }
        if ($search = trim((string) $request->query('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('title', 'like', '%' . $search . '%')
                    ->orWhere('message', 'like', '%' . $search . '%');
            });
        }

        // id-based cursor: everything strictly older than `cursor`.
        if ($cursor = $request->query('cursor')) {
            $query->where('id', '<', (int) $cursor);
        }

        $limit = min((int) $request->query('limit', self::PAGE), 50);
        $rows = $query->limit($limit + 1)->get();

        $hasMore = $rows->count() > $limit;
        $rows = $rows->take($limit);

        return response()->json([
            'items' => $rows->map(fn (Notification $n) => NotificationPresenter::notification($n))->values(),
            'nextCursor' => $hasMore ? $rows->last()->id : null,
            'unread' => $this->unreadCount($request),
        ]);
    }

    /** Badge source of truth (§11): unread and outstanding action-required counts. */
    public function count(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'unread' => $this->unreadCount($request),
            'actionRequired' => Notification::query()
                ->forUser($user)
                ->whereNull('completed_at')
                ->whereIn('level', [Notification::LEVEL_ACTION, Notification::LEVEL_APPROVAL])
                ->count(),
        ]);
    }

    /** Opening a notification marks it read (§20). */
    public function read(Request $request, string $uid): JsonResponse
    {
        $n = $this->find($request, $uid);
        if ($n->read_at === null) {
            $n->forceFill(['read_at' => now()])->save();
        }

        return $this->itemResponse($request, $n);
    }

    /** Let a user put a notification back to unread (§20). */
    public function unread(Request $request, string $uid): JsonResponse
    {
        $n = $this->find($request, $uid);
        $n->forceFill(['read_at' => null])->save();

        return $this->itemResponse($request, $n);
    }

    /** Mark an action-required item's task as done, so it stops being outstanding. */
    public function complete(Request $request, string $uid): JsonResponse
    {
        $n = $this->find($request, $uid);
        $n->forceFill([
            'completed_at' => now(),
            'read_at' => $n->read_at ?? now(),
        ])->save();

        return $this->itemResponse($request, $n);
    }

    /** Mark everything (or one filtered module) read in a single call (§11, §20). */
    public function readAll(Request $request): JsonResponse
    {
        $query = Notification::query()->forUser($request->user())->unread();
        if ($module = $request->input('module')) {
            $query->where('module', $module);
        }
        $query->update(['read_at' => now()]);

        return response()->json(['unread' => $this->unreadCount($request)]);
    }

    /** Dismiss a notification the user is allowed to remove (§20). */
    public function destroy(Request $request, string $uid): JsonResponse
    {
        $n = $this->find($request, $uid);
        $n->delete();

        return response()->json(['ok' => true, 'unread' => $this->unreadCount($request)]);
    }

    /** The user's per-module notification preferences (§21). */
    public function preferences(Request $request): JsonResponse
    {
        return response()->json([
            'groups' => NotificationType::PREFERENCE_GROUPS,
            'channels' => NotificationPreferences::CHANNELS,
            'locked' => NotificationType::NON_SILENCEABLE,
            'preferences' => NotificationPreferences::forUser($request->user()),
        ]);
    }

    /** Merge-save notification preferences (§21). */
    public function updatePreferences(Request $request): JsonResponse
    {
        $input = $request->input('preferences', []);
        if (! is_array($input)) {
            $input = [];
        }

        return response()->json([
            'preferences' => NotificationPreferences::update($request->user(), $input),
        ]);
    }

    private function unreadCount(Request $request): int
    {
        return Notification::query()->forUser($request->user())->unread()->count();
    }

    private function find(Request $request, string $uid): Notification
    {
        return Notification::query()
            ->forUser($request->user())
            ->where('uid', $uid)
            ->firstOrFail();
    }

    private function itemResponse(Request $request, Notification $n): JsonResponse
    {
        $n->load('actor');

        return response()->json([
            'item' => NotificationPresenter::notification($n),
            'unread' => $this->unreadCount($request),
        ]);
    }
}
