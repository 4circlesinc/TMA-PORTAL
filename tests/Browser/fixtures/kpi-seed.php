<?php
/*
 * Fixture for dashboard-kpis.mjs.
 *
 * Enough real activity for all four KPI cards to show a measured number, with
 * the answers spread either side of the 30-day boundary so the deltas have a
 * baseline to compare against. Expects a fresh database — it creates the staff
 * account itself.
 *
 * The numbers are chosen so a wrong answer is obvious rather than plausible:
 * four replies of 3h/2h/4h/1h average to exactly 2h 30m against an 8h prior
 * window (−68.8%), and 9 shares this window against 5 last (+80.0%).
 */

use App\Models\Client;
use App\Models\ConnectedAccount;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\MailMessage;
use App\Models\Message;
use App\Models\Share;
use App\Models\SignatureRequest;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

$staff = User::create(['name' => 'Test User', 'email' => 'e2e@example.com', 'password' => Hash::make('password12345')]);
$staff->forceFill([
    'email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => 'Administrator',
])->save();

$makeClient = function (string $name, string $email) {
    $u = User::create(['name' => $name, 'email' => $email, 'password' => Hash::make('password12345')]);
    $u->forceFill([
        'email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => 'Client',
    ])->save();
    Client::create(['uid' => Str::slug($name), 'user_id' => $u->id, 'name' => $name, 'email' => $email, 'data' => []]);

    return $u;
};

$dana = $makeClient('Dana Reed', 'dana@example.com');
$sam = $makeClient('Sam Okafor', 'sam@example.com');
$mel = $makeClient('Mel Adeyemi', 'mel@example.com');

$talk = function (User $a, User $b) {
    $c = Conversation::create(['type' => 'direct', 'created_by' => $a->id, 'last_message_at' => now()]);
    foreach ([$a, $b] as $u) {
        ConversationParticipant::create(['conversation_id' => $c->id, 'user_id' => $u->id, 'role' => 'member', 'joined_at' => now()]);
    }

    return $c;
};

$say = function (Conversation $c, User $sender, string $ago) {
    $m = Message::create(['conversation_id' => $c->id, 'user_id' => $sender->id, 'type' => 'text', 'body' => 'x']);
    $m->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();
};

// Answered threads — these set the average.
$c1 = $talk($staff, $dana);
$say($c1, $dana, '20 days');
$say($c1, $staff, '19 days 21 hours');   // 3h
$say($c1, $dana, '10 days');
$say($c1, $staff, '9 days 22 hours');    // 2h

$c2 = $talk($staff, $sam);
$say($c2, $sam, '6 days');
$say($c2, $staff, '5 days 20 hours');    // 4h

// Prior window, so the delta has a baseline to compare against (slower then).
$c3 = $talk($staff, $mel);
$say($c3, $mel, '45 days');
$say($c3, $staff, '44 days 16 hours');   // 8h

// Two clients still waiting.
$c4 = $talk($staff, $mel);
$say($c4, $mel, '5 hours');
$c5 = $talk($staff, $sam);
$say($c5, $sam, '2 days');

// Email channel: one answered thread, from a client address.
$account = ConnectedAccount::create([
    'user_id' => $staff->id, 'provider' => 'google', 'provider_id' => 'g-1',
    'email' => $staff->email, 'name' => $staff->name, 'token' => 'refresh', 'scopes' => [], 'sync_email' => true,
]);
MailMessage::create([
    'uuid' => (string) Str::uuid(), 'user_id' => $staff->id, 'connected_account_id' => $account->id,
    'remote_id' => 'g-a', 'thread_id' => 't-1', 'folder' => 'inbox', 'subject' => 'Deed query',
    'from_email' => 'dana@example.com', 'sent_at' => now()->subDays(3),
]);
MailMessage::create([
    'uuid' => (string) Str::uuid(), 'user_id' => $staff->id, 'connected_account_id' => $account->id,
    'remote_id' => 'g-b', 'thread_id' => 't-1', 'folder' => 'sent', 'subject' => 'Re: Deed query',
    'from_email' => $staff->email, 'sent_at' => now()->subDays(3)->addHour(),   // 1h
]);

// Shares: 9 this window, 5 in the prior one, plus a revoked one that must not count.
$folder = Folder::create(['uuid' => (string) Str::uuid(), 'name' => 'Contracts', 'owner_id' => $staff->id, 'created_by' => $staff->id]);
$share = function (string $ago, bool $revoked = false) use ($staff, $folder) {
    $f = FileItem::create([
        'uuid' => (string) Str::uuid(), 'folder_id' => $folder->id, 'name' => 'doc-'.Str::random(4).'.pdf',
        'extension' => 'pdf', 'mime_type' => 'application/pdf', 'size' => 900, 'disk' => 'local',
        'storage_path' => 'vault/'.Str::random(8).'.pdf', 'owner_id' => $staff->id, 'uploaded_by' => $staff->id,
    ]);
    $s = Share::create([
        'uuid' => (string) Str::uuid(), 'token' => Str::random(40), 'item_type' => 'file', 'item_id' => $f->id,
        'shared_by' => $staff->id, 'kind' => 'link', 'role' => 'viewer', 'revoked_at' => $revoked ? now() : null,
    ]);
    $s->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();
};
foreach (['1 day', '2 days', '4 days', '6 days', '8 days', '11 days', '15 days', '20 days', '25 days'] as $ago) {
    $share($ago);
}
foreach (['33 days', '38 days', '42 days', '50 days', '55 days'] as $ago) {
    $share($ago);
}
$share('3 days', revoked: true);

// Two signature requests sent out of the allowance of five.
foreach (['sent', 'completed', 'draft'] as $status) {
    SignatureRequest::create([
        'uuid' => (string) Str::uuid(), 'created_by' => $staff->id, 'title' => 'Engagement letter',
        'status' => $status, 'sent_at' => $status === 'draft' ? null : now()->subDays(4),
    ]);
}

echo "seeded\n";
