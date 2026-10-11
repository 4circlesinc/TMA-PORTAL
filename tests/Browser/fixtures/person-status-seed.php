<?php

/*
 * Two post-approval families for cip-person-status.mjs.
 *
 *   LIN     decided Approved and still collecting its COR documents. The main
 *           applicant's are all accepted, the spouse's are filed and unread,
 *           the child's are not filed: one person at Apply for COR on a file
 *           that is still Approved.
 *   OKAFOR  the whole family at Apply for NIC, COR collected, confirmed, sent
 *           and received. The main applicant's NIC documents are accepted and
 *           nobody else's are filed.
 *
 * Walked there through the same verbs the portal uses, so the statuses the
 * check reads are the ones the rules produced, not ones typed into a column.
 * Needs the standard throwaway database: an administrator e2e@example.com, a
 * service provider with code GAL, and the seeded post-approval requirements.
 * Prints the environment the check wants as its last line.
 *
 *   php artisan tinker tests/Browser/fixtures/person-status-seed.php
 */

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Decision;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Pack;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Review;
use App\Support\Cip\Stages;
use App\Support\Cip\Status;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

$admin = User::where('email', 'e2e@example.com')->firstOrFail();
$provider = CipProvider::where('code', 'GAL')->firstOrFail();
auth()->setUser($admin);

$pdf = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF";

$family = function (string $last, array $names) use ($admin, $provider) {
    $application = Applications::create($provider, $admin, ['investment_type' => 'donation']);
    $client = Client::create([
        'uid' => Str::slug($names[0].' '.$last).'-'.Str::lower(Str::random(5)),
        'name' => $names[0].' '.$last,
        'email' => Str::slug($names[0].'.'.$last, '.').'.'.Str::lower(Str::random(4)).'@example.com',
        'created_by' => $admin->id,
        'data' => [],
    ]);
    $application->forceFill(['client_id' => $client->id])->save();

    CipPerson::create(['application_id' => $application->id, 'role' => CipPerson::ROLE_MAIN_APPLICANT,
        'first_name' => $names[0], 'last_name' => $last, 'gender' => 'male', 'date_of_birth' => now()->subYears(41)]);
    CipPerson::create(['application_id' => $application->id, 'role' => CipPerson::ROLE_DEPENDENT,
        'relationship' => CipPerson::RELATIONSHIP_SPOUSE, 'first_name' => $names[1], 'last_name' => $last,
        'gender' => 'female', 'date_of_birth' => now()->subYears(38)]);
    CipPerson::create(['application_id' => $application->id, 'role' => CipPerson::ROLE_DEPENDENT,
        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED, 'first_name' => $names[2], 'last_name' => $last,
        'gender' => 'female', 'date_of_birth' => now()->subYears(9)]);

    $application->forceFill([
        'status' => Status::GRANTED,
        'decision' => CipApplication::DECISION_GRANTED,
        'decided_at' => now(),
        'cip_number' => '10T'.random_int(1, 9).'R'.random_int(10000, 99999).'P',
    ])->save();

    PostApproval::enter($application->fresh(['people']), $admin);

    return $application->fresh();
};

// The three of them by who they are, never by the order a relation returns.
$people = function (CipApplication $application): array {
    $all = $application->people()->get();

    return [
        $all->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT),
        $all->firstWhere('relationship', CipPerson::RELATIONSHIP_SPOUSE),
        $all->firstWhere('relationship', CipPerson::RELATIONSHIP_QUALIFIED),
    ];
};

// File everything this person is required to hand over for one pack, and
// accept it unless told to leave it unread.
$hand = function (CipApplication $application, CipPerson $person, string $pack, bool $accept = true) use ($admin, $pdf) {
    $slots = Review::constrainToPack(
        CipDocument::query()
            ->where('application_id', $application->id)
            ->where('person_id', $person->id)
            ->where('required', true),
        $pack,
        $application->fresh(),
    )->orderBy('id')->get();

    foreach ($slots as $slot) {
        if (! $slot->file_id) {
            $upload = $slot->type === DocumentTypes::PASSPORT_PHOTO
                ? UploadedFile::fake()->image('photo.jpg', 600, 600)
                : UploadedFile::fake()->createWithContent($slot->type.'.pdf', $pdf);
            DocumentSlots::fill($person->fresh(['application', 'documents']), $slot->type, $upload, $admin);
        }

        if ($accept && $slot->fresh()->status !== DocumentStatus::READY_FOR_SUBMISSION) {
            Review::approve($slot->fresh(), $admin);
            Review::settle($application->fresh(), $admin);
        }
    }
};

$decide = fn (CipApplication $application) => Decision::record(
    $application->fresh(),
    $admin,
    Status::POST_APPROVED,
    null,
    '',
    UploadedFile::fake()->createWithContent('decision-letter.pdf', $pdf),
);

$lin = $family('Lin', ['Lin', 'Mei', 'Hua']);
$decide($lin);
[$linMain, $linSpouse] = $people($lin);
$hand($lin, $linMain, Pack::COR);
$hand($lin, $linSpouse, Pack::COR, false);

$oka = $family('Okafor', ['Chidi', 'Ada', 'Zuri']);
$decide($oka);
foreach ($people($oka) as $person) {
    $hand($oka, $person, Pack::COR);
}
Confirmation::confirm($oka->fresh(), $admin);
Stages::record($oka->fresh(), $admin, Stages::COR_SUBMITTED, Carbon::parse('2026-09-20'));
Stages::record($oka->fresh(), $admin, Stages::COR_RECEIVED, Carbon::parse('2026-09-28'), 'COR-2026-0042');
[$okaMain, $okaSpouse] = $people($oka);
$hand($oka, $okaMain, Pack::NIC);

echo implode(' ', [
    'TMA_APP_COR='.$lin->uuid,
    'TMA_PERSON_READY='.$linMain->uuid,
    'TMA_PERSON_OPEN='.$linSpouse->uuid,
    'TMA_APP_NIC='.$oka->uuid,
    'TMA_PERSON_NIC_READY='.$okaMain->uuid,
    'TMA_PERSON_NIC_OPEN='.$okaSpouse->uuid,
]).PHP_EOL;
