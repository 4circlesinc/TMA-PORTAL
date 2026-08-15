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
use Illuminate\Http\UploadedFile;
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
     * A real square image of a given size, as an upload.
     *
     * Drawn rather than fixtured: the rules are about pixel dimensions, and a
     * test that has to ship a 600×600 JPEG to prove 599 is refused proves it
     * badly. UploadedFile::fake()->image() would do the drawing, but not the
     * bytes — the validator reads them with GD.
     */
    private function photo(int $width = 600, ?int $height = null): UploadedFile
    {
        $img = imagecreatetruecolor($width, $height ?? $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));

        $path = tempnam(sys_get_temp_dir(), 'cip').'.jpg';
        imagejpeg($img, $path, 90);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    /** A scanned document — the bytes are never inspected, only the size. */
    private function scan(string $name = 'scan.pdf'): UploadedFile
    {
        return UploadedFile::fake()->create($name, 40, 'application/pdf');
    }

    /**
     * @return array<string, mixed>
     *
     * Flat rather than nested for the same reason the request is: this is a
     * multipart body, and `sponsor[firstName]` is how one carries a sponsor.
     */
    private function payload(CipProvider $provider, array $overrides = []): array
    {
        return array_merge([
            'providerId' => $provider->uuid,
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'passportPhoto' => $this->photo(),
            'passportBioPage' => $this->scan('bio.pdf'),
            'birthCertificate' => $this->scan('birth.pdf'),
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
        ], $overrides);
    }

    /** The whole sponsor block §4 asks for when Sponsored is Yes. */
    private function sponsor(array $overrides = []): array
    {
        return ['sponsor' => array_merge([
            'firstName' => 'Maryam',
            'lastName' => 'Haddad',
            'gender' => 'Female',
            'dateOfBirth' => '1960-02-02',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'Lebanon',
            'occupation' => 'Retired',
            'passportNumber' => 'S7654321',
            'passportPhoto' => $this->photo(),
        ], $overrides)];
    }

    /** Post the intake the way the form does — multipart, not JSON. */
    private function file(User $actor, array $payload)
    {
        return $this->actingAs($actor)
            ->post('/portal/cip/applications', $payload, ['Accept' => 'application/json']);
    }

    public function test_a_complete_application_is_filed_as_a_numbered_draft(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->file($staff,
                $this->payload($provider))
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

        $body = $this->file($staff, $this->payload($provider, [
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

            $this->file($staff,
                    $payload)
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
        $this->file($staff,
                $this->payload($provider, [
                'investmentType' => InvestmentType::OTHER,
            ]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('investmentTypeOther');

        $body = $this->file($staff,
                $this->payload($provider, [
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

        $this->file($staff,
                $this->payload($provider, ['gender' => 'Other']))
            ->assertStatus(422)->assertJsonValidationErrors('gender');

        $this->file($staff,
                $this->payload($provider, ['countryOfBirth' => 'Atlantis']))
            ->assertStatus(422)->assertJsonValidationErrors('countryOfBirth');

        $this->file($staff,
                $this->payload($provider, ['dateOfBirth' => now()->addYear()->toDateString()]))
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
        $this->file($contact,
                $this->payload($mine))
            ->assertCreated();

        // Another firm's code is not theirs to file under, even if named.
        $this->file($contact,
                $this->payload($theirs))
            ->assertStatus(422);
    }

    public function test_a_private_client_files_under_the_private_bucket(): void
    {
        $private = $this->provider(CipProvider::PRIVATE_CLIENT_CODE);
        $account = $this->user(Role::CLIENT);
        Client::create(['uid' => 'asem', 'name' => 'Asem', 'user_id' => $account->id, 'data' => []]);

        $form = $this->actingAs($account)->getJson('/portal/cip/applications/form')->assertOk()->json();
        $this->assertSame(['PRI'], collect($form['providers'])->pluck('code')->all());

        $body = $this->file($account,
                $this->payload($private))
            ->assertCreated()->json('application');

        $this->assertStringStartsWith('PRI', $body['internalNumber']);
    }

    public function test_a_stranger_cannot_reach_the_wizard_at_all(): void
    {
        $stranger = $this->user(Role::CLIENT);
        $provider = $this->provider('GAL');

        // 404, not 403: the module does not exist for them.
        $this->actingAs($stranger)->getJson('/portal/cip/applications/form')->assertNotFound();
        $this->file($stranger,
                $this->payload($provider))
            ->assertNotFound();
    }

    public function test_the_module_flag_closes_intake_for_everyone(): void
    {
        config(['services.cip.enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->actingAs($admin)->getJson('/portal/cip/applications/form')->assertNotFound();
        $this->file($admin,
                $this->payload($provider))
            ->assertNotFound();
    }

    public function test_the_passport_photo_becomes_the_applicants_profile_picture(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->file($staff,
                $this->payload($provider))
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
        $this->file($staff,
                $this->payload($provider, [
                'passportPhoto' => $this->photo(400),
            ]))
            ->assertStatus(422)->assertJsonValidationErrors('passportPhoto');

        // Big enough, but a portrait snapshot — centre-cropping it would cut
        // the head the government wants framed, so it is refused, not fixed.
        $this->file($staff,
                $this->payload($provider, [
                'passportPhoto' => $this->photo(600, 900),
            ]))
            ->assertStatus(422)->assertJsonValidationErrors('passportPhoto');

        // Not an image at all.
        $this->file($staff,
                $this->payload($provider, [
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

        $this->file($staff,
                $this->payload($provider))
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

    public function test_saying_yes_to_sponsored_files_the_sponsor_in_the_same_save(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1'],
            $this->sponsor(),
        )))->assertCreated()->json('application');

        // §4: the sponsor is not a follow-up step somebody can skip.
        $this->assertSame('Maryam Haddad', $body['sponsor']['name']);
        $this->assertSame('Sponsor', $body['sponsor']['label']);
        $this->assertSame(2, $body['familySize']);

        $sponsor = CipPerson::firstWhere('role', CipPerson::ROLE_SPONSOR);
        $this->assertNotNull($sponsor->photo_url, 'a sponsor has a face like everyone else');
        $this->assertNotNull($sponsor->folder_id, 'and their own document repository');

        // Their checklist exists from the first save, mostly unanswered —
        // that is what makes it a checklist rather than a pile of uploads.
        $this->assertSame(
            ['Passport bio page', 'Birth certificate'],
            \App\Support\Cip\DocumentSlots::outstanding($sponsor),
        );
    }

    public function test_a_sponsored_application_will_not_file_without_the_sponsor(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, ['sponsored' => '1']))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['sponsor.firstName', 'sponsor.passportPhoto']);

        $this->assertSame(0, CipApplication::count());

        // ...and an unsponsored one files with no sponsor at all.
        $body = $this->file($staff, $this->payload($provider))
            ->assertCreated()->json('application');
        $this->assertNull($body['sponsor']);
    }

    public function test_qualified_dependents_are_numbered_from_the_youngest(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, [
            'dependents' => [
                ['firstName' => 'Nadia', 'lastName' => 'Smith', 'dateOfBirth' => '1990-01-01',
                    'relationship' => CipPerson::RELATIONSHIP_SPOUSE],
                ['firstName' => 'Omar', 'lastName' => 'Smith', 'dateOfBirth' => '2010-05-05',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
                ['firstName' => 'Lina', 'lastName' => 'Smith', 'dateOfBirth' => '2016-09-09',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
                ['firstName' => 'Sami', 'lastName' => 'Smith', 'dateOfBirth' => '2013-03-03',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
            ],
        ]))->assertCreated()->json('application');

        // §5's worked example: youngest first. Lina (2016) is QD1.
        $numbered = collect($body['dependents'])
            ->filter(fn ($d) => $d['relationship'] === CipPerson::RELATIONSHIP_QUALIFIED)
            ->sortBy('dependentOrdinal')
            ->pluck('name')->values()->all();
        $this->assertSame(['Lina Smith', 'Sami Smith', 'Omar Smith'], $numbered);

        // A spouse is a dependent but not a *qualified* one, so numbering
        // them would shift every ordinal on the government's form.
        $spouse = collect($body['dependents'])->firstWhere('name', 'Nadia Smith');
        $this->assertNull($spouse['dependentOrdinal']);
        $this->assertSame('Spouse', $spouse['label']);

        $this->assertSame(5, $body['familySize']);
    }

    public function test_removing_a_dependent_renumbers_the_rest(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, [
            'dependents' => [
                ['firstName' => 'Omar', 'lastName' => 'S', 'dateOfBirth' => '2010-05-05',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
                ['firstName' => 'Lina', 'lastName' => 'S', 'dateOfBirth' => '2016-09-09',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
            ],
        ]))->assertCreated();

        $application = CipApplication::first();
        $lina = CipPerson::firstWhere('first_name', 'Lina');
        $this->assertSame(1, $lina->dependent_ordinal);

        // The ordinal is a position in a list, so losing QD1 must not leave
        // the application with a QD2 and no QD1.
        $lina->delete();
        \App\Support\Cip\Dependents::renumber($application->fresh());

        $this->assertSame(1, CipPerson::firstWhere('first_name', 'Omar')->dependent_ordinal);

        // ...and the folder follows the label rather than keeping a stale one.
        \App\Support\Cip\Tree::resyncNames($application->fresh());
        $this->assertSame(
            'Qualified Dependent 1',
            \App\Models\Folder::find(CipPerson::firstWhere('first_name', 'Omar')->folder_id)->name,
        );
    }

    public function test_the_application_gets_a_client_record_and_a_folder_per_person(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        // An administrator exists so the firm's owner is demonstrably not the
        // officer filing — with only one user, every fallback resolves to them.
        $this->user(Role::ADMINISTRATOR);
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $provider = $this->provider('GAL', $company);

        $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1', 'dependents' => [
                ['firstName' => 'Lina', 'lastName' => 'Smith', 'dateOfBirth' => '2016-09-09',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
            ]],
            $this->sponsor(),
        )))->assertCreated();

        $application = CipApplication::first();

        // The applicant becomes a client-hub record, so the Service-Provider
        // path and the Private-Client path have the same shape.
        $client = Client::find($application->client_id);
        $this->assertNotNull($client, 'the applicant is a client record now');
        $this->assertSame('John Smith', $client->name);
        $this->assertSame($company->id, $client->referred_by_company_id);

        // §6's tree, under that client's folder rather than loose in the
        // library — where the firm-wide downloader default would reach it.
        $root = \App\Models\Folder::find($application->folder_id);
        $this->assertSame('Application '.$application->internal_number, $root->name);
        $this->assertSame($client->folder_id, $root->parent_id);

        $children = \App\Models\Folder::where('parent_id', $root->id)->pluck('name')->sort()->values()->all();
        $this->assertSame(
            ['Additional Documents', 'Main Applicant', 'Qualified Dependent 1', 'Sponsor'],
            $children,
        );

        // Owned by the firm, not the person who pressed Add: an owner's
        // rights cannot be revoked, and folders cascade on user delete.
        $this->assertSame(\App\Support\Files\FolderProvisioner::systemOwnerId(), $root->owner_id);
        $this->assertNotSame($staff->id, $root->owner_id);
    }

    public function test_the_intake_uploads_land_in_document_slots(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider))
            ->assertCreated()->json('application');

        // §2's three uploads are answers to requirements from the first save,
        // not loose files Phase 3 would have to find and re-home.
        $this->assertSame(
            ['Passport photo', 'Passport bio page', 'Birth certificate'],
            collect($body['applicant']['documents'])->pluck('label')->all(),
        );
        $this->assertTrue(collect($body['applicant']['documents'])->every(fn ($d) => $d['uploaded']));
        $this->assertSame([], $body['applicant']['outstanding']);

        $main = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $slot = \App\Models\CipDocument::where('person_id', $main->id)
            ->where('type', \App\Support\Cip\DocumentTypes::BIRTH_CERTIFICATE)->first();

        // Through Vault and Versions like every other file in the portal, so
        // these are ordinary library objects with ordinary history.
        $file = \App\Models\FileItem::find($slot->file_id);
        $this->assertSame($main->folder_id, $file->folder_id);
        $this->assertSame('John Smith — Birth certificate.pdf', $file->name);
        $this->assertDatabaseHas('file_versions', ['file_id' => $file->id, 'version_number' => 1]);
    }

    public function test_a_bio_page_that_is_not_a_document_is_refused(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, [
            'passportBioPage' => UploadedFile::fake()->create('notes.exe', 20),
        ]))->assertStatus(422)->assertJsonValidationErrors('passportBioPage');

        $this->file($staff, $this->payload($provider, [
            'birthCertificate' => UploadedFile::fake()->create('huge.pdf', 20480, 'application/pdf'),
        ]))->assertStatus(422)->assertJsonValidationErrors('birthCertificate');

        $this->assertSame(0, CipApplication::count());
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
