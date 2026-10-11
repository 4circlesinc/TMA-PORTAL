<?php

/*
 * Three post-approval families for cip-next-step-menu.mjs, each standing
 * where the next dated step is waiting on something different.
 *
 *   MARSH   still collecting its COR documents. The main applicant's are all
 *           accepted, the spouse's are filed and unread: one person at Apply
 *           for COR on a file that is still Post-Approval.
 *   NOLAN   every COR document accepted, so the file is at Apply for COR, and
 *           nobody has confirmed submission.
 *   OSEI    the same, with the package confirmed: the COR submission date is
 *           the next thing to record.
 *
 * Walked there through the same verbs the portal uses. Needs the standard
 * throwaway database: an administrator e2e@example.com, a service provider
 * with code GAL, and the seeded post-approval requirements. Prints the
 * environment the check wants as its last line. The check records dates on
 * OSEI, so seed fresh families for each run.
 *
 *   php artisan tinker tests/Browser/fixtures/next-step-seed.php < /dev/null
 */

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Pack;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Review;
use App\Support\Cip\Status;
use Illuminate\Http\UploadedFile;
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
        'first_name' => $names[0], 'last_name' => $last, 'gender' => 'male', 'date_of_birth' => now()->subYears(44)]);
    CipPerson::create(['application_id' => $application->id, 'role' => CipPerson::ROLE_DEPENDENT,
        'relationship' => CipPerson::RELATIONSHIP_SPOUSE, 'first_name' => $names[1], 'last_name' => $last,
        'gender' => 'female', 'date_of_birth' => now()->subYears(40)]);

    $application->forceFill([
        'status' => Status::GRANTED,
        'decision' => CipApplication::DECISION_GRANTED,
        'decided_at' => now(),
        'cip_number' => '10T'.random_int(1, 9).'R'.random_int(10000, 99999).'P',
    ])->save();

    PostApproval::enter($application->fresh(['people']), $admin);

    return $application->fresh();
};

// The two of them by who they are, never by the order a relation returns.
$people = function (CipApplication $application): array {
    $all = $application->people()->get();

    return [
        $all->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT),
        $all->firstWhere('relationship', CipPerson::RELATIONSHIP_SPOUSE),
    ];
};

// File everything this person owes for the COR pack, and accept it unless
// told to leave it unread.
$hand = function (CipApplication $application, CipPerson $person, bool $accept = true) use ($admin, $pdf) {
    $slots = Review::constrainToPack(
        CipDocument::query()
            ->where('application_id', $application->id)
            ->where('person_id', $person->id)
            ->where('required', true),
        Pack::COR,
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

$marsh = $family('Marsh', ['Owen', 'Tessa']);
[$marshMain, $marshSpouse] = $people($marsh);
$hand($marsh, $marshMain);
$hand($marsh, $marshSpouse, false);

$nolan = $family('Nolan', ['Felix', 'Ines']);
[$nolanMain, $nolanSpouse] = $people($nolan);
$hand($nolan, $nolanMain);
$hand($nolan, $nolanSpouse);

$osei = $family('Osei', ['Kofi', 'Abena']);
[$oseiMain, $oseiSpouse] = $people($osei);
$hand($osei, $oseiMain);
$hand($osei, $oseiSpouse);
Confirmation::confirm($osei->fresh(), $admin);

$stand = fn (CipApplication $application) => $application->fresh()->status;
if ($stand($marsh) !== Status::POST_APPROVAL || $stand($nolan) !== Status::APPLY_FOR_COR || $stand($osei) !== Status::APPLY_FOR_COR) {
    throw new RuntimeException('The seeded families did not land where the check expects: '
        .$stand($marsh).', '.$stand($nolan).', '.$stand($osei));
}

echo implode(' ', [
    'TMA_APP_WAITING='.$marsh->uuid,
    'TMA_PERSON_AHEAD='.$marshMain->uuid,
    'TMA_APP_UNCONFIRMED='.$nolan->uuid,
    'TMA_PERSON_UNCONFIRMED='.$nolanSpouse->uuid,
    'TMA_APP_CONFIRMED='.$osei->uuid,
    'TMA_PERSON_CONFIRMED='.$oseiSpouse->uuid,
]).PHP_EOL;
