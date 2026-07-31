<?php

namespace App\Support\Files;

use App\Events\FilePresenceChanged;
use App\Models\FileItem;
use App\Models\FilePresenceSession;
use App\Models\User;
use Illuminate\Support\Facades\Log;

/**
 * Who has a file open, right now.
 *
 * The rule §13 states plainly: never claim somebody is viewing a document
 * because of something they did earlier. Presence here is only ever a session
 * that has sent a heartbeat within the last {@see FilePresenceSession::
 * STALE_SECONDS} seconds. Nothing infers it from activity, from a share, or
 * from a page having been loaded once.
 *
 * Sessions are per TAB, not per person: the same user with a file open twice is
 * two rows, so closing one does not wrongly announce that they have left.
 */
class Presence
{
    public const ACTIONS = ['viewing', 'editing', 'commenting'];

    /** Faces shown before the stack collapses to "+N". */
    public const FACES = 5;

    /**
     * Record or renew a heartbeat.
     *
     * Returns true when this is a NEW arrival, so the caller can decide whether
     * anyone else needs telling — a renewal every 20 seconds must not broadcast.
     */
    public static function heartbeat(FileItem $file, User $user, string $sessionId, string $action = 'viewing', ?string $device = null): bool
    {
        $action = in_array($action, self::ACTIONS, true) ? $action : 'viewing';

        $existing = FilePresenceSession::where('file_id', $file->id)
            ->where('session_id', $sessionId)
            ->first();

        if ($existing) {
            // A row that went stale and came back is an arrival again: the
            // person's avatar had already been dropped from everyone's stack.
            $wasStale = ! $existing->isLive();

            $existing->update([
                'user_id' => $user->id,
                'action' => $action,
                'last_heartbeat_at' => now(),
            ]);

            if ($wasStale) {
                self::announce($file, 'joined');
            }

            return $wasStale;
        }

        FilePresenceSession::create([
            'file_id' => $file->id,
            'user_id' => $user->id,
            'session_id' => $sessionId,
            'action' => $action,
            'device' => $device,
            'opened_at' => now(),
            'last_heartbeat_at' => now(),
        ]);

        self::announce($file, 'joined');

        return true;
    }

    /** Explicit departure — closing the viewer, rather than aging out. */
    public static function leave(FileItem $file, string $sessionId): void
    {
        $deleted = FilePresenceSession::where('file_id', $file->id)
            ->where('session_id', $sessionId)
            ->delete();

        if ($deleted) {
            self::announce($file, 'left');
        }
    }

    /**
     * The live roster, one entry per PERSON (their tabs collapsed).
     *
     * @return array{viewers: list<array>, total: int, extra: int}
     */
    public static function roster(FileItem $file, User $viewer): array
    {
        $cutoff = now()->subSeconds(FilePresenceSession::STALE_SECONDS);

        $sessions = FilePresenceSession::where('file_id', $file->id)
            ->where('last_heartbeat_at', '>=', $cutoff)
            ->with('user:id,name,email,job_title,account_type,avatar_url,provider_avatar_url')
            ->orderByDesc('last_heartbeat_at')
            ->get()
            ->filter(fn (FilePresenceSession $s) => $s->user !== null)
            // Someone who has since lost access must not keep appearing on the
            // roster of a file they can no longer open.
            ->filter(fn (FilePresenceSession $s) => FileAccess::fileRole($s->user, $file) !== null);

        $people = [];
        foreach ($sessions as $session) {
            $id = $session->user_id;

            if (isset($people[$id])) {
                // Two tabs: the more engaged action wins, so someone typing a
                // comment in one tab isn't reported as merely viewing.
                $people[$id]['action'] = self::strongerAction($people[$id]['action'], $session->action);

                continue;
            }

            $people[$id] = [
                'id' => $id,
                'name' => $session->user->name,
                'email' => $session->user->email,
                'avatar' => $session->user->photoUrl(),
                'role' => $session->user->job_title ?: $session->user->account_type,
                'action' => $session->action,
                'isSelf' => $id === $viewer->id,
                'since' => optional($session->opened_at)->toIso8601String(),
            ];
        }

        $people = array_values($people);

        foreach ($people as &$person) {
            $person['label'] = match ($person['action']) {
                'editing' => 'Editing',
                'commenting' => 'Commenting',
                default => 'Currently viewing',
            };
        }
        unset($person);

        return [
            'viewers' => array_slice($people, 0, self::FACES),
            'all' => $people,
            'total' => count($people),
            'extra' => max(0, count($people) - self::FACES),
        ];
    }

    private static function strongerAction(string $a, string $b): string
    {
        $rank = ['viewing' => 1, 'commenting' => 2, 'editing' => 3];

        return ($rank[$b] ?? 0) > ($rank[$a] ?? 0) ? $b : $a;
    }

    /** Remove sessions that stopped renewing. Called by the scheduler. */
    public static function prune(): int
    {
        return FilePresenceSession::where('last_heartbeat_at', '<', now()->subMinutes(10))->delete();
    }

    private static function announce(FileItem $file, string $action): void
    {
        try {
            // toOthers(): the person arriving already knows they arrived, and
            // their own browser re-rendering its own stack is wasted work.
            broadcast(new FilePresenceChanged($file, $action))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('Presence.announce failed', ['file' => $file->uuid, 'error' => $e->getMessage()]);
        }
    }
}
