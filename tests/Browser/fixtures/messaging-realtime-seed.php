<?php

/*
 * Two people who talk to each other for messaging-realtime.mjs, and a few
 * more so the first one's inbox holds conversations to step away into.
 *
 * Test User (e2e@example.com) and Ana Ruiz (user0@example.com) share a
 * direct conversation with a message each way; every Peer has written to
 * Test User once. All are administrators, so the firm chat that makes itself
 * holds them too. Safe to run again: accounts and conversations are reused.
 *
 *   php artisan tinker --execute="require 'tests/Browser/fixtures/messaging-realtime-seed.php';" < /dev/null
 */

use App\Models\Message;
use App\Models\User;
use App\Support\Messaging\ClientConversations;
use Illuminate\Support\Facades\Hash;

$make = function (string $name, string $email) {
    $user = User::firstOrCreate(['email' => $email], ['name' => $name, 'password' => Hash::make('password12345')]);
    // Not mass-assignable; without them sign-in stops at email verification.
    $user->forceFill([
        'name' => $name,
        'email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved',
        'account_type' => 'Administrator',
    ])->save();

    return $user;
};

$say = function (User $from, $conversation, string $body) {
    $message = $conversation->messages()->create([
        'user_id' => $from->id, 'type' => Message::TYPE_TEXT, 'body' => $body,
    ]);
    $conversation->forceFill(['last_message_at' => $message->created_at])->save();
};

$a = $make('Test User', 'e2e@example.com');
$b = $make('Ana Ruiz', 'user0@example.com');

$shared = ClientConversations::resolveDirect($a, $b);
if (! $shared->messages()->exists()) {
    $say($a, $shared, 'Hey Ana, can you try the feature we spoke about yesterday?');
    $say($b, $shared, 'Which one should I try?');
}

for ($i = 1; $i <= 4; $i++) {
    $peer = $make("Peer 0{$i}", "peer{$i}@example.com");
    $thread = ClientConversations::resolveDirect($a, $peer);
    if (! $thread->messages()->exists()) {
        $say($peer, $thread, "Hello from peer {$i}");
    }
}

echo 'seeded '.User::count()." accounts\n";
