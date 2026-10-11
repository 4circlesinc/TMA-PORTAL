<?php

/*
 * One application for cip-confirm-submission.mjs: a pre-approval file
 * standing at Ready to submit, every required document filed and accepted,
 * its package not yet confirmed.
 *
 * The documents are filed and accepted through the portal's own verbs, so the
 * package is ready because the checklist says so. The status is then set
 * straight to Ready to submit: walking a file there by hand is a review this
 * check is not about, and the confirm verb judges the package again itself.
 *
 * Needs the standard throwaway database: an administrator e2e@example.com, a
 * service provider with code GAL, and the seeded document requirements.
 * Prints the environment the check wants as its last line. The check confirms
 * the application it is given, so seed a fresh one for each run.
 *
 *   php artisan tinker tests/Browser/fixtures/confirm-ready-seed.php < /dev/null
 */

use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Review;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

$admin = User::where('email', 'e2e@example.com')->firstOrFail();
$provider = CipProvider::where('code', 'GAL')->firstOrFail();
auth()->setUser($admin);

$pdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";

$application = Applications::create($provider, $admin, ['investment_type' => 'donation']);
$client = Client::create([
    'uid' => 'rosa-marlow-'.Str::lower(Str::random(5)),
    'name' => 'Rosa Marlow',
    'email' => 'rosa.marlow.'.Str::lower(Str::random(4)).'@example.com',
    'created_by' => $admin->id,
    'data' => [],
]);
$application->forceFill(['client_id' => $client->id])->save();

$person = CipPerson::create([
    'application_id' => $application->id,
    'role' => CipPerson::ROLE_MAIN_APPLICANT,
    'first_name' => 'Rosa',
    'last_name' => 'Marlow',
    'gender' => 'female',
    'date_of_birth' => now()->subYears(36),
]);

Tree::provision($application->fresh(['people']), $admin);
$person = $person->fresh();
$person->setRelation('application', $application->fresh());

foreach (DocumentSlots::open($person)->where('required', true) as $slot) {
    if (! $slot->file_id) {
        $upload = $slot->type === DocumentTypes::PASSPORT_PHOTO
            ? UploadedFile::fake()->image('photo.jpg', 600, 600)
            : UploadedFile::fake()->createWithContent($slot->type.'.pdf', $pdf);
        DocumentSlots::fill($person->fresh(['application', 'documents']), $slot->type, $upload, $admin);
    }

    if ($slot->fresh()->status !== DocumentStatus::READY_FOR_SUBMISSION) {
        Review::approve($slot->fresh(), $admin);
    }
}

$application->fresh()->forceFill(['status' => Status::READY_TO_SUBMIT])->save();
$application = $application->fresh();

if (! Review::packageReady($application)) {
    throw new RuntimeException('The seeded package is not ready: '.implode('; ', Review::blockers($application)));
}

echo 'TMA_APP='.$application->uuid.PHP_EOL;
