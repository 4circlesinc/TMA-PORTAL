<?php

use App\Models\Conversation;
use App\Models\FeedChannel;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Feed\FeedAccess;
use App\Support\Files\FileAccess;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

/**
 * The staff-wide "refetch this" channel — the Users, Clients, People, calendar
 * and admin tables.
 *
 * Staff only, and it is the reason {@see App\Events\PortalDataChanged} carries
 * a resource name and nothing else. Every subscriber here has a different
 * reach (an employee is not assigned to every client), so the event cannot
 * describe *what* changed without describing it to people who may not see it.
 * Naming only the surface keeps the read rules where they are enforced: in the
 * endpoint each tab refetches through.
 */
Broadcast::channel('portal.staff', function (User $user) {
    return Role::isStaff($user);
});

/**
 * Live updates for one conversation.
 *
 * This is the websocket half of the same rule the HTTP endpoints enforce: a
 * user may only subscribe to a conversation they are currently a participant
 * of. Without it, knowing a uuid would be enough to listen in on a thread.
 */
Broadcast::channel('conversation.{uuid}', function (User $user, string $uuid) {
    return Conversation::query()
        ->forUser($user)
        ->where('uuid', $uuid)
        ->exists();
});

/**
 * A user's own fan-out channel: events that are about them rather than about
 * one conversation - a new thread they were added to, or an unread count
 * changing while they have a different conversation open.
 */
Broadcast::channel('messaging.user.{id}', function (User $user, string $id) {
    return (int) $user->id === (int) $id;
});

/**
 * Live updates for one Feed channel.
 *
 * The websocket half of the same rule the HTTP endpoints enforce: a user may
 * only subscribe to a channel they can actually read. Without it, knowing a
 * uuid would be enough to watch a private channel's traffic — and although the
 * event payload carries no content, the pattern of activity is itself
 * information.
 */
/**
 * Live updates for one file: comments, and later presence and workflow.
 *
 * The websocket half of the same rule FileAccess enforces on every HTTP
 * endpoint — a user may only subscribe to a file they can actually open.
 * Without it, knowing a uuid would be enough to watch a client-private
 * document's discussion.
 */
Broadcast::channel('file.{uuid}', function (User $user, string $uuid) {
    $file = FileItem::query()->withTrashed()->where('uuid', $uuid)->first();

    return $file !== null && FileAccess::can($user, 'view', $file);
});

Broadcast::channel('feed.channel.{uuid}', function (User $user, string $uuid) {
    $channel = FeedChannel::query()->where('uuid', $uuid)->first();

    return $channel !== null && FeedAccess::canView($channel, $user);
});
