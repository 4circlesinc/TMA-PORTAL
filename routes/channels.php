<?php

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
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
