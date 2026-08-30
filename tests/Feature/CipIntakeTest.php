<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\Countries;
use App\Support\Cip\Dependents;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use App\Support\Clients\ClientDirectory;
use App\Support\Files\FolderProvisioner;
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

    /**
     * A provider the way the product registers one: a company made a provider.
     *
     * Not a bare CipProvider row. The wizard offers only firms whose company
     * is live in the hub — a registration whose company is missing or binned
     * is a half-present firm the Service providers tab cannot show — so a
     * fixture without one would be testing a state the portal refuses to
     * offer.
     */
    private function provider(string $code = 'GAL', ?Company $company = null): CipProvider
    {
        $company ??= Company::create([
            'uid' => strtolower($code).'-firm-'.uniqid(),
            'name' => $code.' Provider',
        ]);

        $provider = CipProvider::create([
            'name' => $code.' Provider',
            'code' => $code,
            'company_id' => $company->id,
        ]);

        return $provider;
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
            'policeCertificate' => [$this->scan('police.pdf')],
            'medicalCertificate' => [$this->scan('medical.pdf')],
            'proofOfAddress' => [$this->scan('address.pdf')],
            'evidenceOfFunds' => [$this->scan('funds.pdf')],
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
        $staff = $this->user(Role::ADMINISTRATOR);
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

        // It starts in New Applications — the same queue the chip and the
        // dashboard name.
        $this->assertSame(Status::NEW, $body['status']);

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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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

    public function test_a_post_approval_application_can_be_created_at_intake(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, [
            'phase' => Phase::POST_APPROVAL,
            'oathOfAllegiance' => $this->scan('oath.pdf'),
            'proofOfPayment' => $this->scan('payment.pdf'),
        ]))
            ->assertCreated()
            ->json('application');

        $this->assertSame(Phase::POST_APPROVAL, $body['phase']);
        $this->assertSame(Status::POST_APPROVAL, $body['status']);
        $this->assertNotNull($body['postApprovalAt']);

        $application = CipApplication::where('uuid', $body['id'])->first();
        $this->assertSame(Phase::POST_APPROVAL, $application->phase);
        $this->assertSame(Status::POST_APPROVAL, $application->status);
        $this->assertNotNull($application->post_approval_at);

        $main = $application->people()->where('role', CipPerson::ROLE_MAIN_APPLICANT)->first();
        $this->assertTrue(
            $main->documents()->where('type', CorRequirements::OATH_OF_ALLEGIANCE)->whereNotNull('file_id')->exists()
        );
        $this->assertTrue(
            $main->documents()->where('type', CorRequirements::PROOF_OF_PAYMENT)->whereNotNull('file_id')->exists()
        );
        $this->assertTrue(
            $main->documents()->where('type', CorRequirements::LETTER_OF_CONFIRMATION)->exists(),
            'Real Estate COR documents belong on the post-approval checklist even when filed at intake.',
        );
    }

    public function test_post_approval_intake_demands_required_cor_documents(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, ['phase' => Phase::POST_APPROVAL]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['oathOfAllegiance', 'proofOfPayment']);
    }

    public function test_donation_post_approval_intake_does_not_demand_real_estate_documents(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, [
            'phase' => Phase::POST_APPROVAL,
            'investmentType' => InvestmentType::NATIONAL_ECONOMIC_FUND,
            'oathOfAllegiance' => $this->scan('oath.pdf'),
            'proofOfPayment' => $this->scan('payment.pdf'),
        ]))
            ->assertCreated()
            ->json('application');

        $main = CipApplication::where('uuid', $body['id'])->first()
            ->people()->where('role', CipPerson::ROLE_MAIN_APPLICANT)->first();

        $this->assertFalse(
            $main->documents()->where('type', CorRequirements::LETTER_OF_CONFIRMATION)->exists()
        );
    }

    public function test_intake_defaults_to_pre_approval_when_phase_is_omitted(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider))
            ->assertCreated()
            ->json('application');

        $this->assertSame(Phase::PRE_APPROVAL, $body['phase']);
        $this->assertNull($body['postApprovalAt']);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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

        /*
         * Their checklist exists from the first save, mostly unanswered —
         * that is what makes it a checklist rather than a pile of uploads.
         *
         * Asserted as "these are among the outstanding" rather than as the
         * whole list: since phase 3 the list is the firm's requirement
         * templates, and a test that pinned every row would fail the first
         * time somebody edited one in the portal, which is the feature.
         */
        $outstanding = DocumentSlots::outstanding($sponsor);
        $this->assertContains('Passport bio page', $outstanding);
        $this->assertContains('Birth certificate', $outstanding);
    }

    public function test_a_sponsors_scans_are_offered_but_never_demanded(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1'],
            $this->sponsor(['passportBioPage' => [$this->scan('sponsor-bio.pdf')]]),
        )))->assertCreated()->json('application');

        // What was sent answers the sponsor's own slot, on the sponsor's own
        // folder — not the applicant's.
        $sponsor = CipPerson::firstWhere('role', CipPerson::ROLE_SPONSOR);
        $outstanding = DocumentSlots::outstanding($sponsor);
        $this->assertNotContains('Passport bio page', $outstanding, 'the one they sent is answered');
        $this->assertContains('Birth certificate', $outstanding, 'the ones they did not still stand');

        $slot = CipDocument::where('person_id', $sponsor->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)->first();
        $file = FileItem::find($slot->file_id);
        $this->assertSame($sponsor->folder_id, $file->folder_id);
        $this->assertSame('Maryam Haddad - Passport bio page.pdf', $file->name);

        // The main applicant's own slots are untouched by any of it: what the
        // form collected for them is filed, and a sponsor's upload did not
        // reach into their checklist.
        $this->assertSame(
            [],
            array_intersect(
                ['Passport photo', 'Passport bio page', 'Birth certificate'],
                $body['applicant']['outstanding'],
            ),
        );
    }

    public function test_a_sponsored_application_will_not_file_without_the_sponsor(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
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
        $staff = $this->user(Role::ADMINISTRATOR);
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

    public function test_a_dependents_uploads_are_filed_into_their_own_folder(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, [
            'dependents' => [
                [
                    'firstName' => 'Lina',
                    'lastName' => 'Smith',
                    'dateOfBirth' => '2016-09-09',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    'passportPhoto' => $this->photo(),
                    'passportBioPage' => $this->scan('lina-bio.pdf'),
                    'birthCertificate' => $this->scan('lina-birth.pdf'),
                ],
            ],
        ]))->assertCreated()->json('application');

        $lina = collect($body['dependents'])->firstWhere('name', 'Lina Smith');
        $this->assertNotNull($lina);
        $this->assertNotEmpty($lina['photo'], 'the passport photo is their face');
        $this->assertContains(
            'Passport bio page',
            collect($lina['documents'])->where('uploaded', true)->pluck('label')->all(),
        );

        $person = CipPerson::query()->where('uuid', $lina['id'])->first();
        $this->assertNotNull($person->folder_id);
        $slot = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();
        $this->assertNotNull($slot?->file_id);
        $file = FileItem::find($slot->file_id);
        $parent = $file->folder_id === $person->folder_id
            ? true
            : Folder::query()->where('id', $file->folder_id)->where('parent_id', $person->folder_id)->exists();
        $this->assertTrue($parent, 'the bio page landed under the dependent, not the main applicant');
    }

    /**
     * §5's worked example, run verbatim.
     *
     * The brief prints a table — Child A aged 8, Child B 12, Child C 18,
     * classified 1, 2, 3 — under the rule "youngest dependent receives the
     * lowest number". The other numbering test uses dates a decade apart to
     * make the sort obvious; this one exists to be the client's own figures,
     * so a future change to the comparison has to disagree with the document
     * out loud.
     */
    public function test_the_briefs_own_worked_example_classifies_the_same_way(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider, [
            'dependents' => collect([['Child A', 8], ['Child B', 12], ['Child C', 18]])
                ->map(fn (array $child) => [
                    'firstName' => $child[0],
                    'lastName' => 'Example',
                    'dateOfBirth' => now()->subYears($child[1])->toDateString(),
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                ])->all(),
        ]))->assertCreated()->json('application');

        $classified = collect($body['dependents'])
            ->mapWithKeys(fn ($d) => [$d['name'] => $d['label']])
            ->all();

        $this->assertSame([
            'Child A Example' => 'Qualified Dependent 1',
            'Child B Example' => 'Qualified Dependent 2',
            'Child C Example' => 'Qualified Dependent 3',
        ], $classified);
    }

    public function test_removing_a_dependent_renumbers_the_rest(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
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
        Dependents::renumber($application->fresh());

        $this->assertSame(1, CipPerson::firstWhere('first_name', 'Omar')->dependent_ordinal);

        // ...and the folder follows the new order rather than keeping a stale
        // name. Folders count the dependants; the classification is the
        // government's answer and stays on the person.
        Tree::resyncNames($application->fresh());
        $this->assertSame(
            'Dependent 1',
            Folder::find(CipPerson::firstWhere('first_name', 'Omar')->folder_id)->name,
        );
    }

    public function test_the_application_gets_a_client_record_and_a_folder_per_person(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        // An administrator exists so the firm's owner is demonstrably not the
        // officer filing — with only one user, every fallback resolves to them.
        $this->user(Role::ADMINISTRATOR);
        $staff = $this->user(Role::ADMINISTRATOR);
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

        // §6's tree, hanging straight off the client's own folder rather than
        // loose in the library — where the firm-wide downloader default would
        // reach it — and with no numbered folder in between: opening a client
        // shows the people.
        $root = Folder::find($application->folder_id);
        $this->assertSame($client->folder_id, $root->id);

        $children = Folder::where('parent_id', $root->id)->pluck('name')->sort()->values()->all();
        $this->assertSame(
            ['Additional Documents', 'Dependent 1', 'Main Applicant', 'Sponsor'],
            $children,
        );

        // Owned by the firm, not the person who pressed Add: an owner's
        // rights cannot be revoked, and folders cascade on user delete.
        $this->assertSame(FolderProvisioner::systemOwnerId(), $root->owner_id);
        $this->assertNotSame($staff->id, $root->owner_id);
    }

    public function test_the_intake_uploads_land_in_document_slots(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $body = $this->file($staff, $this->payload($provider))
            ->assertCreated()->json('application');

        // §2's three uploads are answers to requirements from the first save,
        // not loose files Phase 3 would have to find and re-home.
        $documents = collect($body['applicant']['documents']);
        $intake = ['Passport photo', 'Passport bio page', 'Birth certificate'];

        // The three the form asks for are answered by the save. The rest of
        // the checklist — whatever the firm's templates say — is outstanding,
        // which is the honest state of an application filed a minute ago.
        foreach ($intake as $label) {
            $slot = $documents->firstWhere('label', $label);
            $this->assertNotNull($slot, $label.' has a slot');
            $this->assertTrue($slot['uploaded'], $label.' was filed by the save');
        }
        $this->assertSame(
            [],
            array_intersect($intake, $body['applicant']['outstanding']),
            'nothing the form collected is still outstanding',
        );

        $main = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $slot = CipDocument::where('person_id', $main->id)
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)->first();

        // Through Vault and Versions like every other file in the portal, so
        // these are ordinary library objects with ordinary history.
        $file = FileItem::find($slot->file_id);
        $this->assertSame($main->folder_id, $file->folder_id);
        $this->assertSame('John Smith - Birth certificate.pdf', $file->name);
        $this->assertDatabaseHas('file_versions', ['file_id' => $file->id, 'version_number' => 1]);
    }

    public function test_a_bio_page_that_is_not_a_document_is_refused(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, [
            'passportBioPage' => UploadedFile::fake()->create('notes.exe', 20),
        ]))->assertStatus(422)->assertJsonValidationErrors('passportBioPage.0');

        $this->file($staff, $this->payload($provider, [
            'birthCertificate' => UploadedFile::fake()->create('huge.pdf', 20480, 'application/pdf'),
        ]))->assertStatus(422)->assertJsonValidationErrors('birthCertificate.0');

        $this->assertSame(0, CipApplication::count());
    }

    /**
     * A requirement can be answered with more than one file.
     *
     * A bio page is often a passport's two pages and a birth certificate
     * arrives with its translation, so a control that keeps only the last file
     * dropped on it loses documents that were sent.
     */
    public function test_a_requirement_takes_more_than_one_file(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, [
            'birthCertificate' => [$this->scan('birth.pdf'), $this->scan('translation.pdf')],
        ]))->assertStatus(201);

        $main = CipPerson::where('role', CipPerson::ROLE_MAIN_APPLICANT)->firstOrFail();
        $slot = CipDocument::where('person_id', $main->id)
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)->firstOrFail();

        // One requirement, one answer — the second file is filed beside it
        // rather than becoming a version of a document it is not.
        $this->assertSame(1, CipDocument::where('person_id', $main->id)
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)->count());
        $this->assertDatabaseMissing('file_versions', [
            'file_id' => $slot->file_id, 'version_number' => 2,
        ]);

        $filed = FileItem::where('folder_id', $main->folder_id)
            ->pluck('name')->all();
        $this->assertContains('John Smith - Birth certificate.pdf', $filed);
        $this->assertContains('John Smith - Birth certificate (2).pdf', $filed);
    }

    /**
     * A requirement can name the drawer its uploads are filed into.
     *
     * The admin writes "Passport" on the bio-page template and every bio page
     * lands in Main Applicant → Passport. The name is a child of the person's
     * OWN folder, never a path out of it — that is the constraint — and a
     * template naming nothing keeps filing straight into the person's folder,
     * which is what every requirement did before the column existed.
     */
    public function test_a_requirement_naming_a_folder_files_its_uploads_into_it(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        CipDocumentRequirement::query()
            ->where('applicant_type', ApplicantType::PRINCIPAL_APPLICANT)
            ->where('key', DocumentTypes::PASSPORT_BIO_PAGE)
            ->update(['folder' => 'Passport']);

        $this->file($staff, $this->payload($provider, [
            'passportBioPage' => [$this->scan('front.pdf'), $this->scan('back.pdf')],
        ]))->assertCreated();

        $main = CipPerson::where('role', CipPerson::ROLE_MAIN_APPLICANT)->firstOrFail();
        $drawer = Folder::where('parent_id', $main->folder_id)->where('name', 'Passport')->first();
        $this->assertNotNull($drawer, 'the drawer is a child of the person\'s own folder');

        // Both sheets — the answer and the extra file beside it — in the same
        // drawer, or one requirement's papers end up in two places.
        $this->assertSame(
            ['John Smith - Passport bio page.pdf', 'John Smith - Passport bio page (2).pdf'],
            FileItem::where('folder_id', $drawer->id)->orderBy('id')->pluck('name')->all(),
        );

        // The birth certificate's template names no folder, so it files where
        // it always did.
        $birth = CipDocument::where('person_id', $main->id)
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)->firstOrFail();
        $this->assertSame($main->folder_id, FileItem::find($birth->file_id)->folder_id);
    }

    /** One file on its own is still a list of one — the endpoint takes both. */
    public function test_a_single_file_is_accepted_where_a_list_is_expected(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, [
            'birthCertificate' => $this->scan('birth.pdf'),
        ]))->assertStatus(201);

        $main = CipPerson::where('role', CipPerson::ROLE_MAIN_APPLICANT)->firstOrFail();
        $this->assertNotNull(CipDocument::where('person_id', $main->id)
            ->where('type', DocumentTypes::BIRTH_CERTIFICATE)->value('file_id'));
    }

    public function test_an_edit_asks_the_same_questions_and_keeps_the_people(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $created = $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1', 'dependents' => [
                ['firstName' => 'Omar', 'lastName' => 'S', 'dateOfBirth' => '2010-05-05',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
                ['firstName' => 'Lina', 'lastName' => 'S', 'dateOfBirth' => '2016-09-09',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
            ]],
            $this->sponsor(),
        )))->assertCreated()->json('application');

        $mainFolderId = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->folder_id;
        $omarUuid = collect($created['dependents'])->firstWhere('name', 'Omar S')['id'];

        // The same body the form posts to create, minus the files: they are
        // already filed, and an edit must not demand them a second time.
        $edit = $this->payload($provider, [
            'occupation' => 'Retired Engineer',
            'sponsored' => '1',
            'dependents' => [
                ['id' => $omarUuid, 'firstName' => 'Omar', 'lastName' => 'S',
                    'dateOfBirth' => '2010-05-05', 'relationship' => CipPerson::RELATIONSHIP_QUALIFIED],
            ],
        ]);
        unset($edit['passportPhoto'], $edit['passportBioPage'], $edit['birthCertificate'], $edit['providerId']);
        $edit = array_merge($edit, $this->sponsor());
        unset($edit['sponsor']['passportPhoto']);

        $body = $this->actingAs($staff)
            ->post('/portal/cip/applications/'.$created['id'], $edit, ['Accept' => 'application/json'])
            ->assertOk()->json('application');

        // Still one application, still the same one.
        $this->assertSame(1, CipApplication::count());
        $this->assertSame($created['internalNumber'], $body['internalNumber']);

        // The applicant was changed, not replaced — the folder their documents
        // are filed in is the folder they still have.
        $this->assertSame('Retired Engineer', $body['applicant']['occupation']);
        $this->assertSame($mainFolderId, CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->folder_id);
        // An edit does not un-file what was already filed. Asserted against
        // the three the form collects, not against an empty checklist: the
        // rest of the requirements were never sent and are still owed.
        $this->assertSame(
            [],
            array_intersect(
                ['Passport photo', 'Passport bio page', 'Birth certificate'],
                $body['applicant']['outstanding'],
            ),
            'the filed uploads survive an edit',
        );

        // Lina was dropped from the form, so she is off the application — and
        // Omar, the only one left, is QD1 now.
        $this->assertCount(1, $body['dependents']);
        $this->assertSame('Omar S', $body['dependents'][0]['name']);
        $this->assertSame(1, $body['dependents'][0]['dependentOrdinal']);
        $this->assertSame('Dependent 1', Folder::find(
            CipPerson::firstWhere('first_name', 'Omar')->folder_id
        )->name);
    }

    public function test_turning_the_sponsor_off_and_on_keeps_the_same_person(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $created = $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1'],
            $this->sponsor(),
        )))->assertCreated()->json('application');

        $sponsorId = CipPerson::firstWhere('role', CipPerson::ROLE_SPONSOR)->id;
        $edit = $this->payload($provider, ['sponsored' => '0']);
        unset($edit['passportPhoto'], $edit['passportBioPage'], $edit['birthCertificate'], $edit['providerId']);

        $off = $this->actingAs($staff)
            ->post('/portal/cip/applications/'.$created['id'], $edit, ['Accept' => 'application/json'])
            ->assertOk()->json('application');
        $this->assertNull($off['sponsor'], 'unticking Sponsored takes the sponsor off');

        // Soft-deleted, not destroyed: their folder holds filed documents.
        $this->assertSoftDeleted('cip_people', ['id' => $sponsorId]);

        $back = $this->actingAs($staff)->post(
            '/portal/cip/applications/'.$created['id'],
            array_merge($edit, ['sponsored' => '1'], $this->sponsor(['passportPhoto' => null])),
            ['Accept' => 'application/json'],
        )->assertOk()->json('application');

        $this->assertSame('Maryam Haddad', $back['sponsor']['name']);
        $this->assertSame($sponsorId, CipPerson::firstWhere('role', CipPerson::ROLE_SPONSOR)->id,
            'the same sponsor comes back, not a second one');
    }

    public function test_a_client_profile_can_ask_for_its_application(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider))->assertCreated();
        $client = Client::first();

        $body = $this->actingAs($staff)
            ->getJson('/portal/cip/clients/'.$client->uid.'/application')
            ->assertOk()->json('application');
        $this->assertSame('John Smith', $body['applicant']['name']);

        // A client without one is answered, not refused: plenty of clients
        // predate the module.
        $other = Client::create(['uid' => 'nobody', 'name' => 'No Application', 'data' => []]);
        $this->actingAs($staff)
            ->getJson('/portal/cip/clients/'.$other->uid.'/application')
            ->assertOk()
            ->assertJson(['application' => null, 'client' => null]);
    }

    public function test_the_applicants_passport_photo_becomes_the_clients_picture(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'public'));
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $this->file($staff, $this->payload($provider, array_merge(
            ['sponsored' => '1'],
            $this->sponsor(),
        )))->assertCreated();

        // A CIP client IS the applicant, so the portrait they filed with is
        // the picture every list and header draws for them.
        $client = Client::first();
        $main = CipPerson::firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotNull($client->photo_url);
        $this->assertSame($main->photo_url, $client->photo_url);

        // It rides on the lean directory record, so a row shows a face without
        // loading the profile blob the listing deliberately leaves behind.
        $this->assertSame($client->photo_url, $client->toDirectoryRecord()['photo']);
        $this->assertContains('photo_url', ClientDirectory::COLUMNS);

        // The sponsor has a face of their own, but it is not the client's —
        // they are somebody on the application, not who it is filed for.
        $sponsor = CipPerson::firstWhere('role', CipPerson::ROLE_SPONSOR);
        $this->assertNotNull($sponsor->photo_url);
        $this->assertNotSame($sponsor->photo_url, $client->photo_url);
    }

    public function test_the_form_offers_the_five_investment_types_and_every_country(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $this->provider('GAL');

        $form = $this->actingAs($staff)->getJson('/portal/cip/applications/form')->assertOk()->json();

        $this->assertSame([
            'Real Estate Project', 'National Action Bonds', 'National Economic Fund (Donation)',
            'Enterprise Project', 'Other',
        ], collect($form['investmentTypes'])->pluck('label')->all());

        $this->assertCount(count(Countries::all()), $form['countries']);
        $this->assertSame(['Male', 'Female'], $form['genders']);
    }

    public function test_a_firm_whose_company_is_binned_is_not_offered_for_filing(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $company = Company::create(['uid' => 'galaxy-firm', 'name' => 'Galaxy Partners']);
        $this->provider('GAL', $company);
        $this->provider('BLU');

        $offered = fn () => collect($this->actingAs($staff)
            ->getJson('/portal/cip/applications/form')->assertOk()->json('providers'))
            ->pluck('code')->all();

        $this->assertContains('GAL', $offered());

        /*
         * The company goes to the bin and the firm goes with it, everywhere.
         *
         * The register kept offering Galaxy Partners in the wizard while the
         * Service providers tab — which lists companies — showed no such firm,
         * and a provider the hub cannot show is not a provider anybody can
         * file under. Deleting is refused for provider-backed companies now,
         * but rows binned before that guard existed must not haunt the form.
         */
        $company->delete();

        $this->assertNotContains('GAL', $offered());
        $this->assertContains('BLU', $offered(), 'the live firm is untouched');
    }
}
