<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Countries;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Intake (§2 Application Creation, §3 Investment Types).
 *
 * "All fields are required" is the brief's own sentence, so the interesting
 * cases are the refusals: a half-filled application must not reach the
 * caseload, and the two derived answers — the region and the internal number
 * — must come from the server whatever the form sends.
 */
class CipIntakeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function provider(string $code = 'GAL', ?Company $company = null): CipProvider
    {
        return CipProvider::create([
            'name' => $code.' Provider',
            'code' => $code,
            'company_id' => $company?->id,
        ]);
    }

    /**
     * A square image of a given size, as the data URL the wizard posts.
     *
     * Drawn rather than fixtured: the rules are about pixels, and a test that
     * has to ship a 600×600 JPEG to prove 599 is refused proves it badly.
     */
    private function photo(int $width = 600, ?int $height = null): string
    {
        $img = imagecreatetruecolor($width, $height ?? $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));
        ob_start();
        imagejpeg($img, null, 90);

        return 'data:image/jpeg;base64,'.base64_encode((string) ob_get_clean());
    }

    /** @return array<string, mixed> */
    private function payload(CipProvider $provider, array $overrides = []): array
    {
        return array_merge([
            'passportPhoto' => $this->photo(),
            'providerId' => $provider->uuid,
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => false,
        ], $overrides);
    }

    public function test_a_complete_application_is_filed_as_a_numbered_draft(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider))
            ->assertCreated()
            ->json('application');

        // §7: numbered the moment it exists, and shown as the internal number
        // until a CIP number arrives.
        $this->assertSame('GAL'.now()->format('y').'-00001', $body['internalNumber']);
        $this->assertSame($body['internalNumber'], $body['number']);
        $this->assertNull($body['cipNumber']);

        // It starts as a draft — nothing is in the officers' queues yet.
        $this->assertSame(Status::DRAFT, $body['status']);

        // The applicant is on it, or the number names nobody.
        $this->assertSame('John Smith', $body['applicant']['name']);
        $this->assertSame(1, $body['familySize']);
        $this->assertSame('F1', $body['familyLabel']);

        $this->assertDatabaseHas('cip_people', [
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'passport_number' => 'X1234567',
        ]);
    }

    public function test_the_region_is_derived_from_the_country_never_asked(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->actingAs($staff)->postJson('/portal/cip/applications', $this->payload($provider, [
            'countryOfResidence' => 'Saint Lucia',
            // A form that tried to dictate the region is ignored.
            'region' => 'Antarctica',
        ]))->assertCreated()->json('application');

        $this->assertSame('Caribbean', $body['applicant']['region']);
        $this->assertSame('Caribbean', Countries::region('Saint Lucia'));
    }

    public function test_every_mandatory_field_is_refused_when_missing(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        // §2: "All fields are required."
        foreach ([
            'firstName', 'lastName', 'gender', 'dateOfBirth', 'countryOfBirth',
            'countryOfResidence', 'occupation', 'passportNumber', 'passportPhoto',
            'investmentType', 'sponsored',
        ] as $field) {
            $payload = $this->payload($provider);
            unset($payload[$field]);

            $this->actingAs($staff)
                ->postJson('/portal/cip/applications', $payload)
                ->assertStatus(422)
                ->assertJsonValidationErrors($field);
        }

        $this->assertSame(0, CipApplication::count(), 'no half-filled application should exist');
    }

    public function test_other_investment_type_must_say_what_it_is(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        // §3: choosing Other reveals a required "Specify Investment Type".
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, [
                'investmentType' => InvestmentType::OTHER,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('investmentTypeOther');

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, [
                'investmentType' => InvestmentType::OTHER,
                'investmentTypeOther' => 'Government bond variant',
            ]))
            ->assertCreated()
            ->json('application');

        // The free text is what the record then calls itself.
        $this->assertSame('Government bond variant', $body['investmentType']);
    }

    public function test_gender_and_country_come_from_the_offered_lists(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, ['gender' => 'Other']))
            ->assertStatus(422)->assertJsonValidationErrors('gender');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, ['countryOfBirth' => 'Atlantis']))
            ->assertStatus(422)->assertJsonValidationErrors('countryOfBirth');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, ['dateOfBirth' => now()->addYear()->toDateString()]))
            ->assertStatus(422)->assertJsonValidationErrors('dateOfBirth');
    }

    public function test_a_provider_contact_files_under_their_own_firm_only(): void
    {
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $mine = $this->provider('GAL', $company);
        $theirs = $this->provider('BLU');

        $contact = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        // The wizard offers them one firm, and says so.
        $form = $this->actingAs($contact)->getJson('/portal/cip/applications/form')
            ->assertOk()->json();
        $this->assertSame(['GAL Provider'], collect($form['providers'])->pluck('name')->all());
        $this->assertTrue($form['providerFixed']);

        // §1: Service Providers create applications.
        $this->actingAs($contact)
            ->postJson('/portal/cip/applications', $this->payload($mine))
            ->assertCreated();

        // Another firm's code is not theirs to file under, even if named.
        $this->actingAs($contact)
            ->postJson('/portal/cip/applications', $this->payload($theirs))
            ->assertStatus(422);
    }

    public function test_a_private_client_files_under_the_private_bucket(): void
    {
        $private = $this->provider(CipProvider::PRIVATE_CLIENT_CODE);
        $account = $this->user(Role::CLIENT);
        Client::create(['uid' => 'asem', 'name' => 'Asem', 'user_id' => $account->id, 'data' => []]);

        $form = $this->actingAs($account)->getJson('/portal/cip/applications/form')->assertOk()->json();
        $this->assertSame(['PRI'], collect($form['providers'])->pluck('code')->all());

        $body = $this->actingAs($account)
            ->postJson('/portal/cip/applications', $this->payload($private))
            ->assertCreated()->json('application');

        $this->assertStringStartsWith('PRI', $body['internalNumber']);
    }

    public function test_a_stranger_cannot_reach_the_wizard_at_all(): void
    {
        $stranger = $this->user(Role::CLIENT);
        $provider = $this->provider('GAL');

        // 404, not 403: the module does not exist for them.
        $this->actingAs($stranger)->getJson('/portal/cip/applications/form')->assertNotFound();
        $this->actingAs($stranger)
            ->postJson('/portal/cip/applications', $this->payload($provider))
            ->assertNotFound();
    }

    public function test_the_module_flag_closes_intake_for_everyone(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->actingAs($admin)->getJson('/portal/cip/applications/form')->assertNotFound();
        $this->actingAs($admin)
            ->postJson('/portal/cip/applications', $this->payload($provider))
            ->assertNotFound();
    }

    public function test_the_passport_photo_becomes_the_applicants_profile_picture(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider))
            ->assertCreated()->json('application');

        // One upload, two jobs: the picture drawn beside the applicant's name
        // is the photo that was filed, not a second thing to keep in step.
        $person = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotNull($person->photo_url);
        $this->assertSame($person->photo_url, $body['applicant']['photo']);
        $this->assertStringStartsWith('/media/avatars/', $person->photo_url);

        // ...and the archival copy is kept separately, because the avatar is
        // 320px and what gets filed with the government cannot be.
        $this->assertNotNull($person->photo_path);
        Storage::disk(config('filesystems.avatar_disk', 'public'))->assertExists($person->photo_path);

        [$width] = getimagesizefromstring(
            Storage::disk(config('filesystems.avatar_disk', 'public'))->get($person->photo_path)
        );
        $this->assertSame(600, $width, 'the filed photo keeps the resolution it arrived at');
    }

    public function test_a_photo_that_is_not_two_by_two_is_refused(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        // Square but too small to print at two inches.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, [
                'passportPhoto' => $this->photo(400),
            ]))
            ->assertStatus(422)->assertJsonValidationErrors('passportPhoto');

        // Big enough, but a portrait snapshot — centre-cropping it would cut
        // the head the government wants framed, so it is refused, not fixed.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, [
                'passportPhoto' => $this->photo(600, 900),
            ]))
            ->assertStatus(422)->assertJsonValidationErrors('passportPhoto');

        // Not an image at all.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider, [
                'passportPhoto' => 'data:image/jpeg;base64,'.base64_encode('not a picture'),
            ]))
            ->assertStatus(422)->assertJsonValidationErrors('passportPhoto');

        $this->assertSame(0, CipApplication::count(), 'nothing is filed without a usable photo');
    }

    public function test_the_filed_photo_is_reachable_only_through_the_application(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications', $this->payload($provider))
            ->assertCreated();

        $person = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $url = '/portal/cip/people/'.$person->uuid.'/passport-photo';

        $this->actingAs($staff)->get($url)
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg');

        // A uuid is not an argument for showing someone's face: a reader who
        // cannot open the application cannot see who it is for.
        $stranger = $this->user(Role::CLIENT);
        $this->actingAs($stranger)->get($url)->assertNotFound();
    }

    public function test_the_form_offers_the_five_investment_types_and_every_country(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $this->provider('GAL');

        $form = $this->actingAs($staff)->getJson('/portal/cip/applications/form')->assertOk()->json();

        $this->assertSame([
            'Real Estate Project', 'National Action Bonds', 'National Economic Fund (Donation)',
            'Enterprise Project', 'Other',
        ], collect($form['investmentTypes'])->pluck('label')->all());

        $this->assertCount(count(Countries::all()), $form['countries']);
        $this->assertSame(['Male', 'Female'], $form['genders']);
    }
}
