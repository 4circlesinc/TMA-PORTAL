<?php

namespace Tests\Feature;

use App\Models\CipApplicationDraft;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * The intake wizard's autosave.
 *
 * The interesting cases are all about what a draft is NOT: it is not an
 * application, so it holds no files and appears in nobody else's list; and it
 * does not outlive the filing it became, or the reader would be invited to
 * file the same person twice.
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

    /** @return array<string, string> */
    private function answers(array $overrides = []): array
    {
        return array_merge([
            'firstName' => 'John',
            'lastName' => 'Smith',
            'countryOfResidence' => 'United Arab Emirates',
        ], $overrides);
    }

    private function save(User $actor, array $body)
    {
        return $this->actingAs($actor)
            ->postJson('/portal/cip/applications/draft', $body);
    }

    public function test_a_half_typed_application_is_kept_and_handed_back(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, [
            'phase' => Phase::PRE_APPROVAL,
            'answers' => $this->answers(),
            'dependents' => 2,
        ])->assertOk();

        $read = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertOk();

        $this->assertSame('John', $read->json('draft.answers.firstName'));
        $this->assertSame(2, $read->json('draft.dependents'));
        $this->assertNotNull($read->json('draft.savedAt'));
    }

    public function test_saving_again_replaces_the_draft_rather_than_adding_one(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])->assertOk();
        $this->save($staff, [
            'phase' => Phase::PRE_APPROVAL,
            'answers' => $this->answers(['firstName' => 'Joanne']),
        ])->assertOk();

        $this->assertSame(1, CipApplicationDraft::query()->where('user_id', $staff->id)->count());
        $this->assertSame('Joanne', CipApplicationDraft::query()
            ->where('user_id', $staff->id)->first()->answers['firstName']);
    }

    public function test_the_two_phases_keep_their_own_drafts(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, [
            'phase' => Phase::PRE_APPROVAL,
            'answers' => $this->answers(['firstName' => 'Pre']),
        ])->assertOk();
        $this->save($staff, [
            'phase' => Phase::POST_APPROVAL,
            'answers' => $this->answers(['firstName' => 'Post']),
        ])->assertOk();

        $this->assertSame('Pre', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->json('draft.answers.firstName'));
        $this->assertSame('Post', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::POST_APPROVAL)
            ->json('draft.answers.firstName'));
    }

    /** One reader's unfinished work is nobody else's business. */
    public function test_a_draft_belongs_to_the_reader_who_typed_it(): void
    {
        $mine = $this->user(Role::ADMINISTRATOR);
        $theirs = $this->user(Role::ADMINISTRATOR);

        $this->save($mine, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])->assertOk();

        $this->assertNull($this->actingAs($theirs)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->json('draft'));
    }

    public function test_no_draft_reads_as_nothing_rather_than_an_error(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertOk()
            ->assertJson(['draft' => null]);
    }

    /* An emptied form is how a reader abandons one, so it clears the draft. */
    public function test_an_empty_save_clears_the_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])->assertOk();
        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => []])
            ->assertOk()
            ->assertJson(['draft' => null]);

        $this->assertSame(0, CipApplicationDraft::query()->count());
    }

    public function test_start_over_deletes_the_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])->assertOk();
        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertOk();

        $this->assertSame(0, CipApplicationDraft::query()->count());
    }

    /**
     * A draft holds what was typed, and only that.
     *
     * A key that is not a field path or a value that is not a scalar is
     * something other than an answer, and storing it would put whatever a
     * browser sent back into a form later.
     */
    public function test_only_typed_answers_are_kept(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, [
            'phase' => Phase::PRE_APPROVAL,
            'answers' => [
                'firstName' => 'John',
                'sponsor.firstName' => 'Maryam',
                'dependents.0.dateOfBirth' => '2015-01-01',
                'not a path!' => 'dropped',
                'nested' => ['also' => 'dropped'],
                'blank' => '   ',
            ],
        ])->assertOk();

        $kept = CipApplicationDraft::query()->first()->answers;

        $this->assertSame(['firstName', 'sponsor.firstName', 'dependents.0.dateOfBirth'], array_keys($kept));
    }

    /**
     * Filing is the end of the draft.
     *
     * Cleared by the store endpoint itself, not only by the wizard's DELETE,
     * because an application filed from the offline queue replays that
     * request with nobody at the screen.
     */
    public function test_filing_the_application_clears_the_draft(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])->assertOk();

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

        $this->assertSame(0, CipApplicationDraft::query()->count());
    }

    /** The same square JPEG the intake tests draw, for the same reason. */
    private function photo(int $width = 600): UploadedFile
    {
        $img = imagecreatetruecolor($width, $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));
        $path = tempnam(sys_get_temp_dir(), 'cip').'.jpg';
        imagejpeg($img, $path, 90);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    /**
     * An account with no reach into CIP cannot keep drafts there either.
     *
     * 404 rather than 403, the same answer the rest of the module gives a
     * stranger: whether the firm files citizenship applications is not
     * something an account outside it learns from a status code.
     */
    public function test_an_account_without_cip_access_is_refused(): void
    {
        $stranger = $this->user(Role::CLIENT);

        $this->save($stranger, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])
            ->assertNotFound();
        $this->actingAs($stranger)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->assertNotFound();
    }

    /** The module switched off closes the autosave with everything else. */
    public function test_the_module_flag_closes_the_autosave(): void
    {
        config(['services.cip.enabled' => false]);
        $staff = $this->user(Role::ADMINISTRATOR);

        $this->save($staff, ['phase' => Phase::PRE_APPROVAL, 'answers' => $this->answers()])
            ->assertNotFound();
    }
}
