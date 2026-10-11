<?php

/*
 * One application for cip-messages-tab.mjs, with a thread on the file long
 * enough to run well past a window: seven letters from a colleague in three
 * runs, with a short answer between them. The bubble that ends the first
 * run carries a reaction two people gave, drawn with its count, and the
 * face of one colleague who stopped reading there; the second has nothing
 * under it; the last carries one reaction and the faces of the eight who
 * have read to the end, which is two lines of them.
 *
 * Written through the thread's own verbs. Needs the standard throwaway
 * database: an administrator e2e@example.com and a service provider with
 * code GAL. Prints the environment the check wants as its last line.
 *
 *   php artisan tinker tests/Browser/fixtures/messages-tab-seed.php < /dev/null
 */

use App\Models\CipApplicationMessage;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Threads;
use App\Support\Cip\Tree;
use Illuminate\Support\Str;

$admin = User::where('email', 'e2e@example.com')->firstOrFail();
$provider = CipProvider::where('code', 'GAL')->firstOrFail();

$staff = fn (string $email, string $name) => User::firstOrCreate(['email' => $email], [
    'name' => $name,
    'password' => bcrypt('password12345'),
    'account_type' => Role::ADMINISTRATOR,
    'status' => User::STATUS_APPROVED,
]);
$writer = $staff('tessa.officer@example.com', 'Tessa Officer');
$reader = $staff('ravi.reader@example.com', 'Ravi Reader');

auth()->setUser($admin);

$application = Applications::create($provider, $admin, ['investment_type' => 'donation']);
$client = Client::create([
    'uid' => 'ines-calder-'.Str::lower(Str::random(5)),
    'name' => 'Ines Calder',
    'email' => 'ines.calder.'.Str::lower(Str::random(4)).'@example.com',
    'created_by' => $admin->id,
    'data' => [],
]);
$application->forceFill(['client_id' => $client->id])->save();

CipPerson::create([
    'application_id' => $application->id,
    'role' => CipPerson::ROLE_MAIN_APPLICANT,
    'first_name' => 'Ines',
    'last_name' => 'Calder',
    'gender' => 'female',
    'date_of_birth' => now()->subYears(39),
]);
Tree::provision($application->fresh(['people']), $admin);
$application = $application->fresh();

$letter = "Good day,\nWe wish to inform you that the application for citizenship ".$application->displayNumber()
    ." in the name of INES CALDER is compliant as of September 17, 2026. Due diligence checks on this application"
    ." are in progress and this application will proceed for a decision by the Citizenship by Investment Board once"
    ." completed.\n\nWe aim to provide a decision on applications within one hundred and eighty (180) days from the"
    ." date of compliance. Consequently, you can expect to get a NOTIFICATION LETTER regarding the Citizenship by"
    ." Investment Board's decision on this application by March 16, 2027.";

auth()->setUser($writer);
$fourth = null;
foreach (range(1, 4) as $i) {
    $fourth = Threads::create($application, $writer, $letter, CipApplicationMessage::LANE_INTERNAL);
}

auth()->setUser($admin);
Threads::create($application, $admin, 'Noted, thank you.', CipApplicationMessage::LANE_INTERNAL);
// The same reaction from two people is drawn with a count, a taller row.
Threads::react($application, $fourth->fresh(), $admin, '👍');

// A run of one, with nothing under its bubble.
auth()->setUser($writer);
Threads::create($application, $writer, $letter, CipApplicationMessage::LANE_INTERNAL);

auth()->setUser($admin);
Threads::create($application, $admin, 'Understood.', CipApplicationMessage::LANE_INTERNAL);

auth()->setUser($writer);
Threads::create($application, $writer, $letter, CipApplicationMessage::LANE_INTERNAL);
$last = Threads::create($application, $writer, $letter, CipApplicationMessage::LANE_INTERNAL);

// Somebody else has read to the end and left a reaction on the last letter.
auth()->setUser($reader);
Threads::markRead($application, $reader);
Threads::react($application, $last->fresh(), $reader, '👍');
Threads::react($application, $fourth->fresh(), $reader, '👍');

// One colleague stopped at the end of the first run: one face under it.
$early = $staff('una.early@example.com', 'Una Early');
auth()->setUser($early);
Threads::markRead($application, $early, $fourth->id);

// And seven more have read to the end: eight faces, which is two lines.
foreach (['Aldo', 'Bea', 'Cato', 'Dina', 'Emil', 'Fay', 'Gus'] as $name) {
    $late = $staff(strtolower($name).'.late@example.com', $name.' Late');
    auth()->setUser($late);
    Threads::markRead($application, $late);
}

echo 'TMA_APP='.$application->uuid.PHP_EOL;
