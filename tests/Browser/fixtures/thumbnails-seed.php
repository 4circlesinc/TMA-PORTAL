<?php

/*
 * Files that prove the four thumbnail paths apart:
 *   - a photograph, which the server thumbnails with GD,
 *   - a PDF with something on page one, which the server cannot rasterise (no
 *     ghostscript) and pdf.js has to paint,
 *   - a PDF whose first page is blank, which must fall back to its type icon
 *     rather than hang a white rectangle in the row,
 *   - a .docx, which nothing can preview and must keep its type icon.
 *
 * Seeded twice: once in a plain folder (File Library, Dashboard, Overview) and
 * once inside a client's folder, which is the Client hub's own list.
 */

use App\Models\Client;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
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

$put = function (Folder $folder, string $name, string $ext, string $mime, string $bytes) use ($staff) {
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

/**
 * The smallest thing that is really a PDF: catalog, pages, one blank
 * US-Letter page, with a computed xref so pdf.js opens it rather than
 * refusing it. The PHP twin of fixtures/tiny-pdf.mjs — all ASCII, so string
 * length is byte offset.
 */
function blankPdf(): string
{
    $objects = [
        "1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n",
        "2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n",
        "3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>\nendobj\n",
    ];

    $body = "%PDF-1.4\n";
    $offsets = [];
    foreach ($objects as $object) {
        $offsets[] = strlen($body);
        $body .= $object;
    }

    $xrefAt = strlen($body);
    $xref = "xref\n0 ".(count($objects) + 1)."\n0000000000 65535 f \n";
    foreach ($offsets as $at) {
        $xref .= str_pad((string) $at, 10, '0', STR_PAD_LEFT)." 00000 n \n";
    }

    $trailer = "trailer\n<</Size ".(count($objects) + 1)."/Root 1 0 R>>\n"
        ."startxref\n".$xrefAt."\n%%EOF\n";

    return $body.$xref.$trailer;
}

$pdf = file_get_contents(base_path('tests/Browser/fixtures/contract.pdf'));
$png = file_get_contents(base_path('tests/Browser/fixtures/message-large.png'));
$docx = str_repeat('x', 2048);
$docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

$folder = Folder::create([
    'uuid' => (string) Str::uuid(),
    'name' => 'Thumb Test',
    'owner_id' => $staff->id,
    'created_by' => $staff->id,
]);

$put($folder, 'Passport photo.png', 'png', 'image/png', $png);
$put($folder, 'Engagement letter.pdf', 'pdf', 'application/pdf', $pdf);
$put($folder, 'Cover sheet.pdf', 'pdf', 'application/pdf', blankPdf());
$put($folder, 'Quarterly report.docx', 'docx', $docxMime, $docx);

$client = Client::create([
    'uid' => 'chen-wei',
    'name' => 'Chen Wei',
    'email' => 'chen@example.com',
    'data' => [],
    'created_by' => $staff->id,
]);
$clientFolder = FolderProvisioner::provisionClientFolder($client, $staff);

$put($clientFolder, 'Chen Wei — Passport photo.png', 'png', 'image/png', $png);
$put($clientFolder, 'Chen Wei — Passport bio page.pdf', 'pdf', 'application/pdf', $pdf);

echo "folder={$folder->uuid}\n";
echo "clientFolder={$clientFolder->uuid}\n";
