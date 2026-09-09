<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * The intake wizard's draft, which is an application at Status::DRAFT.
 *
 * The two claims worth pinning are the ones the design rests on: a draft is a
 * real row in the applications table, and DRAFT is the whole of its status
 * vocabulary — the picker offers nothing, and the only way out is to file it.
 */
class CipApplicationDraftTest extends TestCase
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

    private function provider(string $code = 'GAL'): CipProvider
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm-'.uniqid(),
            'name' => $code.' Provider',
        ]);

        return CipProvider::create([
            'name' => $code.' Provider',
            'code' => $code,
            'company_id' => $company->id,
        ]);
    }

    /** @return array<string, mixed> */
    private function answers(CipProvider $provider, array $overrides = []): array
    {
        return array_merge([
            'providerId' => $provider->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'firstName' => 'John',
            'lastName' => 'Smith',
            'countryOfResidence' => 'United Arab Emirates',
        ], $overrides);
    }

    private function save(User $actor, array $body)
    {
        return $this->actingAs($actor)->postJson('/portal/cip/applications/draft', $body);
    }

    /** The claim the whole change rests on. */
    public function test_a_draft_is_a_real_application_row_at_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();

        $draft = CipApplication::query()->first();
        $this->assertNotNull($draft);
        $this->assertSame(Status::DRAFT, $draft->status);
        // It carries a number, so the firm can refer to it like anything else.
        $this->assertNotNull($draft->internal_number);
        $this->assertSame('John', $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
    }

    /**
     * Draft is the whole vocabulary.
     *
     * Not a filter somewhere in the UI — the engine itself offers no status a
     * draft may be moved to, and refuses one driven by hand. An application
     * that has never been completed has no business being marked Ready to
     * submit, and the only way out is the submit verb.
     */
    public function test_a_draft_offers_no_other_status(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $this->save($staff, $this->answers($provider))->assertOk();

        $draft = CipApplication::query()->first();

        // Nothing to pick, on the map or off it, for an administrator who may
        // otherwise override anything.
        $this->assertSame([], Engine::availableOverrides($draft, $staff));
        $this->assertSame([], Engine::lockedStatuses($draft, $staff));

        // And the generic status endpoint refuses to move it.
        $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$draft->uuid.'/status',
            ['status' => Status::READY_TO_SUBMIT],
        )->assertStatus(422);

        $this->assertSame(Status::DRAFT, $draft->fresh()->status);
    }

    /** DRAFT itself is not something anybody may set a file to. */
    public function test_a_filed_application_cannot_be_pushed_back_to_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $application = Applications::create($provider, $staff, []);

        $this->actingAs($staff)->postJson(
            '/portal/cip/applications/'.$application->uuid.'/status',
            ['status' => Status::DRAFT],
        )->assertStatus(422);

        $this->assertSame(Status::NEW, $application->fresh()->status);
    }

    public function test_saving_again_updates_the_same_draft_rather_than_numbering_a_second(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();
        $this->save($staff, $this->answers($provider, ['firstName' => 'Joanne']))->assertOk();

        $this->assertSame(1, CipApplication::query()->count());
        $this->assertSame('Joanne', CipApplication::query()->first()
            ->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
    }

    /** Half-typed is the ordinary state of a draft, so nothing is required. */
    public function test_an_incomplete_form_is_saved_without_complaint(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, [
            'providerId' => $provider->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'firstName' => 'Amara',
        ])->assertOk();

        $this->assertSame(1, CipApplication::query()->where('status', Status::DRAFT)->count());
    }

    /** Shape is still enforced: a wrong answer is wrong however unfinished. */
    public function test_a_malformed_answer_is_still_refused(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, ['countryOfBirth' => 'Atlantis']))
            ->assertStatus(422);
        $this->save($staff, $this->answers($provider, ['dateOfBirth' => 'not-a-date']))
            ->assertStatus(422);
    }

    public function test_the_two_phases_keep_their_own_drafts(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, ['firstName' => 'Pre']))->assertOk();
        $this->save($staff, $this->answers($provider, [
            'firstName' => 'Post',
            'phase' => Phase::POST_APPROVAL,
        ]))->assertOk();

        $this->assertSame(2, CipApplication::query()->where('status', Status::DRAFT)->count());
        $this->assertSame('Pre', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->json('draft.answers.firstName'));
        $this->assertSame('Post', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::POST_APPROVAL)
            ->json('draft.answers.firstName'));
    }

    /** Resumed by its author alone, however many people can see the row. */
    public function test_a_draft_is_resumed_only_by_the_reader_who_typed_it(): void
    {
        $mine = $this->user(Role::ADMINISTRATOR);
        $theirs = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($mine, $this->answers($provider))->assertOk();

        $this->assertNull($this->actingAs($theirs)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->json('draft'));
    }

    /** But it IS in the table, which is the point of the change. */
    public function test_a_draft_appears_in_the_applications_listing(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $this->save($staff, $this->answers($provider))->assertOk();

        $rows = $this->actingAs($staff)
            ->getJson('/portal/cip/applications')
            ->assertOk()
            ->json('applications');

        $this->assertCount(1, $rows);
        $this->assertSame(Status::DRAFT, $rows[0]['status']);
    }

    public function test_an_empty_save_discards_the_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();
        $this->save($staff, ['providerId' => $provider->uuid, 'phase' => Phase::PRE_APPROVAL])
            ->assertOk()
            ->assertJson(['draft' => null]);

        $this->assertSame(0, CipApplication::query()->count());
    }

    public function test_start_over_deletes_the_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();
        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertOk();

        $this->assertSame(0, CipApplication::query()->count());
    }

    /**
     * Filing completes the draft rather than numbering a second application.
     *
     * The bug this pins: creating a new row would leave the draft behind as
     * an orphan wearing the same applicant's name.
     */
    public function test_filing_moves_the_draft_to_new_rather_than_creating_another(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();
        $draftNumber = CipApplication::query()->first()->internal_number;

        $this->actingAs($staff)->post('/portal/cip/applications', [
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
            'passportBioPage' => UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            'birthCertificate' => UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf'),
            'policeCertificate' => [UploadedFile::fake()->create('police.pdf', 40, 'application/pdf')],
            'proofOfAddress' => [UploadedFile::fake()->create('address.pdf', 40, 'application/pdf')],
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
        ], ['Accept' => 'application/json'])->assertCreated();

        $this->assertSame(1, CipApplication::query()->count());
        $filed = CipApplication::query()->first();
        $this->assertSame(Status::NEW, $filed->status);
        // The same row, so the number it was known by while drafting stands.
        $this->assertSame($draftNumber, $filed->internal_number);
    }

    private function photo(int $width = 600): UploadedFile
    {
        $img = imagecreatetruecolor($width, $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));
        $path = tempnam(sys_get_temp_dir(), 'cip').'.jpg';
        imagejpeg($img, $path, 90);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    public function test_an_account_without_cip_access_is_refused(): void
    {
        $stranger = $this->user(Role::CLIENT);
        $provider = $this->provider();

        $this->save($stranger, $this->answers($provider))->assertNotFound();
        $this->actingAs($stranger)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertNotFound();
    }

    public function test_the_module_flag_closes_the_autosave(): void
    {
        config(['services.cip.enabled' => false]);
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertNotFound();
    }
}
