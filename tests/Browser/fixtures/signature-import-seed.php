<?php

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

$u = User::create([
    'name' => 'Test User',
    'email' => 'e2e@example.com',
    'password' => Hash::make('password12345'),
]);
$u->forceFill([
    'email_verified_at' => now(),
    'profile_completed_at' => now(),
    'onboarding_completed_at' => now(),
    'status' => 'approved',
    'account_type' => 'Administrator',
])->save();

$a = ConnectedAccount::create([
    'user_id' => $u->id,
    'provider' => 'google',
    'provider_id' => 'g1',
    'email' => 'e2e@example.com',
    'name' => 'Test User',
    'token' => 'refresh',
    'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
    'sync_email' => true,
]);
// A cursor stops the page seeding a full sync against a token that cannot work.
$a->forceFill(['mail_cursor' => '100', 'mail_synced_at' => now()])->save();

// Inbox rows so the mailbox page has something to draw.
foreach ([['m1', 'Quarterly review', 'Dana Reed', 'dana@example.com'],
    ['m2', 'Invoice #1042', 'Ana Ruiz', 'ana@example.com']] as $i => $m) {
    MailMessage::create([
        'uuid' => (string) Str::uuid(),
        'user_id' => $u->id,
        'connected_account_id' => $a->id,
        'remote_id' => $m[0],
        'thread_id' => 't'.$i,
        'folder' => 'inbox',
        'subject' => $m[1],
        'snippet' => 'Preview for '.$m[1],
        'from_name' => $m[2],
        'from_email' => $m[3],
        'is_read' => false,
        'sent_at' => now()->subMinutes($i * 30),
    ]);
}

// A tiny valid PNG so the signature logo needs no network at all.
$logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

$signature = '<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">'
    .'<div style="font-family: Arial; color: #1a73e8;"><b>Vernon Francis</b></div>'
    .'<div>Managing Director, TMA Portal</div>'
    .'<div><a href="https://tma.example.com">tma.example.com</a></div>'
    .'<img src="'.$logo.'" width="120" height="40" alt="TMA logo">'
    .'</div>';

$oneOff = '<div class="gmail_signature"><div>One-off footer nobody uses</div></div>';

$sent = [
    ['s1', '<div dir="ltr">Thanks — attached now.</div>'.$signature, 3],
    ['s2', '<div dir="ltr">Confirming Tuesday works.</div>'.$signature, 2],
    ['s3', '<div dir="ltr">Quick reply from my desk.</div>'.$oneOff, 1],
    ['s4', '<div dir="ltr">Final copy for review.</div>'.$signature, 0],
];

foreach ($sent as [$rid, $html, $daysAgo]) {
    MailMessage::create([
        'uuid' => (string) Str::uuid(),
        'user_id' => $u->id,
        'connected_account_id' => $a->id,
        'remote_id' => $rid,
        'thread_id' => 'st-'.$rid,
        'folder' => 'sent',
        'subject' => 'Sent '.$rid,
        'snippet' => 'Sent message',
        'body_html' => $html,
        'from_name' => 'Test User',
        'from_email' => 'e2e@example.com',
        'is_read' => true,
        'sent_at' => now()->subDays($daysAgo),
    ]);
}

echo 'seeded user='.$u->id.' account='.$a->id.' messages='.MailMessage::count();
