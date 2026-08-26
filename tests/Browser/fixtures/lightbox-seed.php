<?php

/*
 * Four files of the four kinds the lightbox draws differently: a PDF that
 * pdf.js has to paint, a photo, a text file, and a type with no in-browser
 * preview at all. `home-library-lightbox.mjs` checks the stage for each, so
 * one of anything is not enough.
 */

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Support\Str;

$staff = User::where('email', 'e2e@example.com')->first();

if (! $staff) {
    $staff = new User(['name' => 'E2E Staff', 'email' => 'e2e@example.com', 'password' => 'password12345']);
    $staff->forceFill([
        'email_verified_at' => now(),
        'status' => User::STATUS_APPROVED,
        'approved_at' => now(),
        'account_type' => 'Administrator',
    ])->save();
}

// Otherwise every portal route bounces to profile-setup, then to
// getting-started, and the dashboard is never reached.
$prefs = $staff->preferences ?? [];
$prefs['accountsSetupComplete'] = true;
$prefs['accountSetupStep'] = 'done';
$staff->forceFill([
    'preferences' => $prefs,
    'profile_completed_at' => now(),
    'onboarding_completed_at' => now(),
])->save();

if (! is_dir(storage_path('app/private/vault'))) {
    mkdir(storage_path('app/private/vault'), 0775, true);
}

$folder = Folder::create([
    'uuid' => (string) Str::uuid(),
    'name' => 'Lightbox Test',
    'owner_id' => $staff->id,
    'created_by' => $staff->id,
]);

$put = function (string $name, string $ext, string $mime, string $bytes) use ($staff, $folder) {
    $path = 'vault/'.Str::random(10).'.'.$ext;
    file_put_contents(storage_path('app/private/'.$path), $bytes);

    return FileItem::create([
        'uuid' => (string) Str::uuid(),
        'folder_id' => $folder->id,
        'name' => $name,
        'extension' => $ext,
        'mime_type' => $mime,
        'size' => strlen($bytes),
        'disk' => 'local',
        'storage_path' => $path,
        'owner_id' => $staff->id,
        'uploaded_by' => $staff->id,
    ]);
};

$put('Engagement letter.pdf', 'pdf', 'application/pdf',
    file_get_contents(base_path('tests/Browser/fixtures/contract.pdf')));
$put('Site photo.png', 'png', 'image/png',
    file_get_contents(base_path('tests/Browser/fixtures/message-photo.png')));
$put('Meeting notes.txt', 'txt', 'text/plain', "Lightbox notes\n\nSecond line of the note.\n");
$put('Quarterly report.docx', 'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', str_repeat('x', 2048));

echo "seeded folder {$folder->uuid} with 4 files\n";
