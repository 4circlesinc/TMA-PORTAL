<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Phase;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
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
        $this->assertSame('JOHN', $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
    }

    /**
     * The hub is named for the person, once there is one.
     *
     * A draft's first autosave often has a country or a photo and no name
     * yet, and the client is minted as "Application GAL26-00005" so the row
     * has something to hang from. Typing the name later used to leave the
     * profile titled after the file. The table already showed the applicant;
     * the client has to follow.
     */
    public function test_the_client_takes_the_applicants_name_when_it_is_typed(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, [
            'firstName' => '',
            'lastName' => '',
        ]))->assertOk();

        $draft = CipApplication::query()->first();
        $this->assertNotNull($draft->client_id);
        $this->assertSame('Application '.$draft->displayNumber(), $draft->client->name);

        $this->save($staff, $this->answers($provider, [
            'firstName' => 'Wei',
            'lastName' => 'Chen',
        ]))->assertOk();

        $client = $draft->fresh()->client;
        $this->assertSame('WEI CHEN', $client->name);
        $this->assertSame('WEI', $client->data['firstName'] ?? null);
        $this->assertSame('CHEN', $client->data['lastName'] ?? null);
    }

    /**
     * The scans are kept, not thrown away.
     *
     * A draft used to hold answers only, so a reader who uploaded six
     * passports and closed the tab came back to an empty form — the part of
     * the work that took longest, gone. The folder question that reasoning
     * was protecting is answered by the draft being deletable instead.
     */
    public function test_a_draft_keeps_its_photo_and_its_scans(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->first();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        // The photo becomes the person's picture and answers its own slot.
        $this->assertNotNull($main->photo_path, 'The photo is kept with the draft.');
        $this->assertTrue(
            $main->documents()->where('type', 'passport_photo')->whereNotNull('file_id')->exists(),
            'And it fills the passport photo slot like a filed one does.',
        );
        $this->assertTrue(
            $main->documents()->where('type', 'passport_bio_page')->whereNotNull('file_id')->exists(),
            'A scan chosen on a draft is filed against its slot.',
        );
    }

    /**
     * Autosaving twice does not fight the first save.
     *
     * The wizard posts the whole form each time, so the second save re-sends
     * a photo the first one filed. DocumentSlots refuses a second upload
     * against a filled slot — rightly, that is what forces Upload new version
     * — so without a skip here every keystroke after choosing a photo
     * answered with a 500.
     */
    public function test_saving_a_draft_twice_with_the_same_photo_does_not_error(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $body = $this->answers($provider, [
            'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
        ]);

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $body, ['Accept' => 'application/json'])
            ->assertOk();

        // The same form again, as the autosave sends it.
        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
                'occupation' => 'Engineer',
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = CipApplication::query()->first();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        // One photo, and the answer typed after it was kept.
        $this->assertSame(1, $main->documents()->where('type', 'passport_photo')->count());
        $this->assertSame('ENGINEER', $main->occupation === null ? '' : mb_strtoupper($main->occupation));
    }

    /**
     * Autosaving a dependent twice must update the same person, not mint another.
     *
     * The wizard used to drop the uuid the first save returned, so every
     * later autosave created a new dependent and soft-deleted the last one.
     * The new row reused "Dependent 1" by name and inherited the wrong
     * passport photo — Suha wearing somebody else's face.
     */
    public function test_saving_a_draft_dependent_twice_keeps_the_same_person_and_photo(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $first = $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [[
                    'firstName' => 'Suha',
                    'lastName' => 'H.Khalil Al - Abtan',
                    'dateOfBirth' => '2012-05-01',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    'passportPhoto' => UploadedFile::fake()->image('suha.jpg', 600, 600),
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk()
            ->json('draft');

        $dependentId = $first['answers']['dependents.0.id'] ?? null;
        $this->assertNotEmpty($dependentId, 'The draft response must name the dependent so the next save updates them.');

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $person = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->firstOrFail();
        $this->assertSame($dependentId, $person->uuid);
        $folderId = $person->folder_id;
        $photoPath = $person->photo_path;
        $this->assertNotNull($folderId);
        $this->assertNotNull($photoPath);

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'occupation' => 'Engineer',
                'dependents' => [[
                    'id' => $dependentId,
                    'firstName' => 'Suha',
                    'lastName' => 'H.Khalil Al - Abtan',
                    'dateOfBirth' => '2012-05-01',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = $draft->fresh(['people']);
        $live = $draft->people->where('role', CipPerson::ROLE_DEPENDENT)->values();
        $this->assertCount(1, $live, 'A second save must not mint another dependent.');
        $this->assertSame($dependentId, $live[0]->uuid);
        $this->assertSame($folderId, $live[0]->folder_id, 'The same person keeps their folder.');
        $this->assertSame($photoPath, $live[0]->photo_path, 'Their passport photo stays theirs.');
        $this->assertSame(0, CipPerson::onlyTrashed()
            ->where('application_id', $draft->id)
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->count(), 'The previous dependent must not be soft-deleted and replaced.');
    }

    /**
     * Every scan is kept, including ones added after the first autosave,
     * and including every dependent's.
     *
     * A slot that already held its first file used to ignore the rest of the
     * list the wizard re-posts, so a second page — and a dependent's papers
     * dropped a moment later — never reached the folder.
     */
    public function test_a_later_autosave_keeps_new_scans_for_every_dependent(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $first = $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'passportBioPage' => [UploadedFile::fake()->createWithContent('main-bio.pdf', 'main bio page one')],
                'dependents' => [[
                    'firstName' => 'Suha',
                    'lastName' => 'Abtan',
                    'dateOfBirth' => '2015-06-01',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    'passportPhoto' => UploadedFile::fake()->image('suha.jpg', 600, 600),
                    'passportBioPage' => [UploadedFile::fake()->createWithContent('suha-bio.pdf', 'suha bio page one')],
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk()
            ->json('draft');

        $suhaId = $first['answers']['dependents.0.id'] ?? null;
        $this->assertNotEmpty($suhaId);

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'passportBioPage' => [
                    UploadedFile::fake()->createWithContent('main-bio.pdf', 'main bio page one'),
                    UploadedFile::fake()->createWithContent('main-bio-2.pdf', 'main bio page two'),
                ],
                'birthCertificate' => [UploadedFile::fake()->createWithContent('main-birth.pdf', 'main birth record')],
                'dependents' => [
                    [
                        'id' => $suhaId,
                        'firstName' => 'Suha',
                        'lastName' => 'Abtan',
                        'dateOfBirth' => '2015-06-01',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                        'passportPhoto' => UploadedFile::fake()->image('suha.jpg', 600, 600),
                        'passportBioPage' => [
                            UploadedFile::fake()->createWithContent('suha-bio.pdf', 'suha bio page one'),
                            UploadedFile::fake()->createWithContent('suha-bio-2.pdf', 'suha bio page two'),
                        ],
                        'birthCertificate' => [UploadedFile::fake()->createWithContent('suha-birth.pdf', 'suha birth record')],
                    ],
                    [
                        'firstName' => 'Omar',
                        'lastName' => 'Abtan',
                        'dateOfBirth' => '2008-03-03',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                        'passportPhoto' => UploadedFile::fake()->image('omar.jpg', 600, 600),
                        'passportBioPage' => [UploadedFile::fake()->createWithContent('omar-bio.pdf', 'omar bio page')],
                        'birthCertificate' => [UploadedFile::fake()->createWithContent('omar-birth.pdf', 'omar birth record')],
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $dependents = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->orderBy('id')->get();

        $this->assertCount(2, $dependents);
        $this->assertSame($suhaId, $dependents[0]->uuid);

        $this->assertNotNull($main->documents()->where('type', 'passport_bio_page')->whereNotNull('file_id')->first());
        $this->assertNotNull($main->documents()->where('type', 'birth_certificate')->whereNotNull('file_id')->first());
        $this->assertSame(2, $this->sheetsNamed($main, 'Passport bio page'), 'The main applicant keeps both bio pages, and the first is not stored twice.');

        $suha = $dependents[0];
        $this->assertNotNull($suha->photo_path);
        $this->assertNotNull($suha->documents()->where('type', 'passport_bio_page')->whereNotNull('file_id')->first());
        $this->assertNotNull($suha->documents()->where('type', 'birth_certificate')->whereNotNull('file_id')->first());
        $this->assertSame(2, $this->sheetsNamed($suha, 'Passport bio page'));
        $this->assertSame(1, $this->sheetsNamed($suha, 'Birth certificate'));

        $omar = $dependents[1];
        $this->assertNotNull($omar->photo_path);
        $this->assertNotNull($omar->documents()->where('type', 'passport_bio_page')->whereNotNull('file_id')->first());
        $this->assertNotNull($omar->documents()->where('type', 'birth_certificate')->whereNotNull('file_id')->first());
        $this->assertSame(1, $this->sheetsNamed($omar, 'Passport bio page'));

        $filed = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?application='.$draft->uuid)
            ->assertOk()
            ->json('draft.filed');

        $this->assertContains('passportBioPage', $filed);
        $this->assertContains('birthCertificate', $filed);
        $this->assertContains('dependents.0.passportBioPage', $filed);
        $this->assertContains('dependents.0.passportPhoto', $filed);
        $this->assertContains('dependents.0.birthCertificate', $filed);
        $this->assertContains('dependents.1.passportBioPage', $filed);
        $this->assertContains('dependents.1.birthCertificate', $filed);
    }

    private function sheetsNamed(CipPerson $person, string $label): int
    {
        $roots = array_values(array_filter([$person->folder_id, $person->post_approval_folder_id]));
        if ($roots === []) {
            return 0;
        }

        $ids = Folder::query()
            ->whereIn('id', $roots)
            ->orWhereIn('parent_id', $roots)
            ->pluck('id');

        return FileItem::query()
            ->whereIn('folder_id', $ids)
            ->where('name', 'like', '%'.$label.'%')
            ->count();
    }

    /**
     * Draft answers must keep dependents in form order, not age order.
     *
     * Qualified-dependent ordinals renumber youngest-first after every save.
     * Returning that order in the draft payload used to stamp the wrong uuid
     * onto each form row; the next autosave then swapped their dates of birth.
     */
    public function test_draft_dependent_answers_keep_form_order_not_age_ordinal(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $first = $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [
                    [
                        'firstName' => 'Older',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2010-01-15',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                    [
                        'firstName' => 'Younger',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2015-06-01',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk()
            ->json('draft');

        $this->assertSame('OLDER', $first['answers']['dependents.0.firstName'] ?? null);
        $this->assertSame('2010-01-15', $first['answers']['dependents.0.dateOfBirth'] ?? null);
        $this->assertSame('YOUNGER', $first['answers']['dependents.1.firstName'] ?? null);
        $this->assertSame('2015-06-01', $first['answers']['dependents.1.dateOfBirth'] ?? null);

        $olderId = $first['answers']['dependents.0.id'] ?? null;
        $youngerId = $first['answers']['dependents.1.id'] ?? null;
        $this->assertNotEmpty($olderId);
        $this->assertNotEmpty($youngerId);
        $this->assertNotSame($olderId, $youngerId);

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $people = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->orderBy('id')->get();
        $this->assertCount(2, $people);
        $this->assertSame(2, $people[0]->dependent_ordinal, 'Older child is QD2.');
        $this->assertSame(1, $people[1]->dependent_ordinal, 'Younger child is QD1.');
        $this->assertSame($olderId, $people[0]->uuid);
        $this->assertSame($youngerId, $people[1]->uuid);

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [
                    [
                        'id' => $olderId,
                        'firstName' => 'Older',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2010-01-15',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                    [
                        'id' => $youngerId,
                        'firstName' => 'Younger',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2015-06-01',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $people = $draft->fresh()->people()->where('role', CipPerson::ROLE_DEPENDENT)->orderBy('id')->get();
        $this->assertSame('2010-01-15', $people[0]->date_of_birth->toDateString());
        $this->assertSame('2015-06-01', $people[1]->date_of_birth->toDateString());
        $this->assertSame('OLDER', $people[0]->first_name);
        $this->assertSame('YOUNGER', $people[1]->first_name);
    }

    /**
     * A passport photo stays on the person it was filed for.
     *
     * The main applicant, the older child and the younger child each keep
     * their own face. A later save that repeats one child's id must not
     * slide the next photo onto somebody else.
     */
    public function test_passport_photos_stay_on_the_person_they_were_filed_for(): void
    {
        Storage::fake('local');
        Storage::fake(config('filesystems.avatar_disk', 'public'));

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $first = $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'passportPhoto' => $this->photo(600),
                'dependents' => [
                    [
                        'firstName' => 'Older',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2010-01-15',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                        'passportPhoto' => $this->photo(620),
                    ],
                    [
                        'firstName' => 'Younger',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2015-06-01',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                        'passportPhoto' => $this->photo(640),
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk()
            ->json('draft');

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $older = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->orderBy('id')->first();
        $younger = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->orderByDesc('id')->first();

        $this->assertNotNull($main->photo_path);
        $this->assertNotNull($older->photo_path);
        $this->assertNotNull($younger->photo_path);
        $this->assertNotSame($main->photo_path, $older->photo_path);
        $this->assertNotSame($main->photo_path, $younger->photo_path);
        $this->assertNotSame($older->photo_path, $younger->photo_path);

        $this->assertStringContainsString($main->uuid, $first['previews']['passportPhoto'] ?? '');
        $this->assertStringContainsString($older->uuid, $first['previews']['dependents.0.passportPhoto'] ?? '');
        $this->assertStringContainsString($younger->uuid, $first['previews']['dependents.1.passportPhoto'] ?? '');
        $this->assertStringNotContainsString($main->uuid, $first['previews']['dependents.0.passportPhoto'] ?? '');
        $this->assertStringNotContainsString($older->uuid, $first['previews']['dependents.1.passportPhoto'] ?? '');

        $record = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$draft->uuid)
            ->assertOk()
            ->json('application');

        $photoUrl = function (CipPerson $person): string {
            $file = $person->documents()->where('type', 'passport_photo')->first()?->file;

            return (string) $file?->uuid;
        };
        $byId = collect($record['dependents'])->keyBy('id');
        $this->assertNotSame('', $photoUrl($main));
        $this->assertStringContainsString($photoUrl($main), $record['applicant']['passportPhotoUrl'] ?? '');
        $this->assertStringContainsString($photoUrl($older), $byId[$older->uuid]['passportPhotoUrl'] ?? '');
        $this->assertStringContainsString($photoUrl($younger), $byId[$younger->uuid]['passportPhotoUrl'] ?? '');
        $this->assertNotSame($record['applicant']['passportPhotoUrl'], $byId[$older->uuid]['passportPhotoUrl']);
        $this->assertNotSame($byId[$older->uuid]['passportPhotoUrl'], $byId[$younger->uuid]['passportPhotoUrl']);

        $mainPhoto = $main->photo_path;
        $olderPhoto = $older->photo_path;
        $youngerPhoto = $younger->photo_path;

        // The same child posted twice, with a new face on the repeat, must
        // not hand that face to the other child.
        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [
                    [
                        'id' => $older->uuid,
                        'firstName' => 'Older',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2010-01-15',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                    [
                        'id' => $older->uuid,
                        'firstName' => 'Older',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2010-01-15',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                        'passportPhoto' => $this->photo(660),
                    ],
                    [
                        'id' => $younger->uuid,
                        'firstName' => 'Younger',
                        'lastName' => 'Child',
                        'dateOfBirth' => '2015-06-01',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft->refresh();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $older = $draft->people()->where('uuid', $older->uuid)->firstOrFail();
        $younger = $draft->people()->where('uuid', $younger->uuid)->firstOrFail();

        $this->assertSame($mainPhoto, $main->photo_path);
        $this->assertNotSame($olderPhoto, $older->photo_path, 'The repeated row replaces that child only.');
        $this->assertSame($youngerPhoto, $younger->photo_path, 'The other child keeps their own passport photo.');
        $this->assertNotSame($main->photo_path, $older->photo_path);
        $this->assertNotSame($older->photo_path, $younger->photo_path);
        $this->assertSame(2, $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->count());
    }

    /**
     * Without the id, a second draft save must still reuse the same person.
     *
     * Uuid is preferred, but concurrent or stale autosaves sometimes omit it.
     * Matching on name (and DOB when present) stops a second Ahmed being
     * minted beside the first — the failure that left Suha with duplicates.
     */
    public function test_a_draft_dependent_save_without_id_reuses_the_same_person(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [[
                    'firstName' => 'Suha',
                    'lastName' => 'Abtan',
                    'dateOfBirth' => '2012-05-01',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    'passportPhoto' => UploadedFile::fake()->image('suha.jpg', 600, 600),
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = CipApplication::query()->firstOrFail();
        $first = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->firstOrFail();
        $firstId = $first->uuid;
        $folderId = $first->folder_id;
        $photoPath = $first->photo_path;

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [[
                    'firstName' => 'Suha',
                    'lastName' => 'Abtan',
                    'dateOfBirth' => '2012-05-01',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = $draft->fresh();
        $live = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->get();
        $this->assertCount(1, $live);
        $this->assertSame($firstId, $live[0]->uuid, 'Omitting the id still updates the same person by name.');
        $this->assertSame($folderId, $live[0]->folder_id);
        $this->assertSame($photoPath, $live[0]->photo_path);
        $this->assertSame(0, CipPerson::onlyTrashed()
            ->where('application_id', $draft->id)
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->count());
    }

    /**
     * A stale form that still lists both duplicate uuids must collapse to one.
     */
    public function test_saving_both_duplicate_dependent_ids_collapses_to_one_person(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [[
                    'firstName' => 'Ahmed',
                    'lastName' => 'Ishan',
                    'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                ]],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $draft = CipApplication::query()->firstOrFail();
        $original = $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->firstOrFail();

        $clone = $draft->people()->make([
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Ahmed',
            'last_name' => 'Ishan',
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
        ]);
        $clone->save();

        $this->assertSame(2, $draft->people()->where('role', CipPerson::ROLE_DEPENDENT)->count());

        $this->actingAs($staff)
            ->post('/portal/cip/applications/draft', $this->answers($provider, [
                'dependents' => [
                    [
                        'id' => $original->uuid,
                        'firstName' => 'Ahmed',
                        'lastName' => 'Ishan',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                    [
                        'id' => $clone->uuid,
                        'firstName' => 'Ahmed',
                        'lastName' => 'Ishan',
                        'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                    ],
                ],
            ]), ['Accept' => 'application/json'])
            ->assertOk();

        $live = $draft->fresh()->people()->where('role', CipPerson::ROLE_DEPENDENT)->get();
        $this->assertCount(1, $live);
        $this->assertSame($original->uuid, $live[0]->uuid);
    }

    /** A resumed draft says which slots it already holds a scan for. */
    public function test_a_resumed_draft_names_the_files_it_kept(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $filed = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft')
            ->assertOk()
            ->json('draft.filed');

        $this->assertContains('passportPhoto', $filed);
        $this->assertContains('passportBioPage', $filed);
        $this->assertNotContains('birthCertificate', $filed, 'A slot nobody filled is not claimed as kept.');

        $draft = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft')
            ->assertOk()
            ->json('draft');

        $this->assertNotEmpty($draft['previews']['passportPhoto'] ?? null, 'The stored photo is a URL the form can show.');
    }

    /**
     * The record the wizard actually reopens must describe the photo as filed.
     *
     * The draft endpoint is not what the table uses: opening a row loads the
     * application, and if that payload does not mark the slot uploaded the
     * form shows the face and still demands a file.
     */
    public function test_a_reopened_draft_record_shows_the_photo_as_filed(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->first();

        $record = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$draft->uuid)
            ->assertOk()
            ->json('application');

        $this->assertSame(Status::DRAFT, $record['status']);
        $this->assertNotEmpty($record['applicant']['passportPhotoUrl']);

        $photo = collect($record['applicant']['documents'])->firstWhere('type', 'passport_photo');
        $this->assertNotNull($photo);
        $this->assertTrue($photo['uploaded'], 'The photo slot is filled, so the form must not ask for it again.');

        $bio = collect($record['applicant']['documents'])->firstWhere('type', 'passport_bio_page');
        $this->assertNotNull($bio);
        $this->assertTrue($bio['uploaded']);
    }

    /**
     * Filing a draft does not demand the photo and scans it already holds.
     *
     * The wizard cannot re-send a file that is already on the server: a
     * reopened draft has a preview, not a File. Asking for the upload again
     * is the form showing the picture and answering "The passport photo
     * field is required."
     */
    public function test_filing_a_draft_does_not_demand_the_files_it_already_holds(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
            'birthCertificate' => [UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->first();

        $filing = $this->filing($provider);
        unset(
            $filing['passportPhoto'],
            $filing['passportBioPage'],
            $filing['birthCertificate'],
        );
        $filing['draftId'] = $draft->uuid;

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::NEW, $filed->status);
        $main = $filed->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotNull($main->photo_path, 'The photo survived filing.');
        $this->assertTrue(
            $main->documents()->where('type', 'passport_photo')->whereNotNull('file_id')->exists(),
        );
        $this->assertTrue(
            $main->documents()->where('type', 'passport_bio_page')->whereNotNull('file_id')->exists(),
        );
        $this->assertTrue(
            $main->documents()->where('type', 'birth_certificate')->whereNotNull('file_id')->exists(),
        );
    }

    /**
     * Filing a form that was never reopened still finds the photo the
     * autosave kept.
     *
     * Create New Application does not put the draft uuid on the wizard, so
     * Add arrives with the submission key and no draftId. The File the reader
     * picked often does not travel with that request either — Morph rebuilds
     * the input, WebKit empties the original File, and the face on screen is
     * only a data URL. The key has to name the row BEFORE the rules run, or
     * Laravel answers "The passport photo field is required" next to it.
     */
    public function test_filing_finds_the_draft_by_submission_key_when_no_file_is_re_sent(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $key = 'sub-wizard-'.uniqid();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'submissionId' => $key,
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
            'birthCertificate' => [UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $filing = $this->filing($provider);
        unset(
            $filing['passportPhoto'],
            $filing['passportBioPage'],
            $filing['birthCertificate'],
        );
        $filing['submissionId'] = $key;

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated();

        $draft = CipApplication::query()->first();
        $this->assertSame(Status::NEW, $draft->fresh()->status);
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotNull($main->photo_path);
    }

    /** A draft that never received a photo still has to bring one at filing. */
    public function test_filing_a_draft_still_asks_for_a_photo_it_never_received(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, [
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
        ]))->assertOk();

        $filing = $this->filing($provider);
        unset($filing['passportPhoto']);

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('passportPhoto');
    }

    /**
     * A post-approval draft files as post-approval, not as New Applications.
     *
     * The wizard's Save used to drive every draft onto NEW. That status is
     * a pre-approval label, and the engine refuses it once the phase is
     * post-approval — a 500 on the button that was supposed to file the form.
     */
    public function test_filing_a_post_approval_draft_lands_in_post_approval(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'phase' => Phase::POST_APPROVAL,
            'cipNumber' => '10T1G12680P',
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
            'birthCertificate' => [UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf')],
            'oathOfAllegiance' => [UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf')],
            'proofOfPayment' => [UploadedFile::fake()->create('payment.pdf', 40, 'application/pdf')],
            'policeCertificate' => [UploadedFile::fake()->create('police.pdf', 40, 'application/pdf')],
            'proofOfAddress' => [UploadedFile::fake()->create('address.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->first();
        $this->assertSame(Phase::POST_APPROVAL, $draft->phase);
        $this->assertSame(Status::DRAFT, $draft->status);

        $filing = $this->filing($provider) + [
            'phase' => Phase::POST_APPROVAL,
            'cipNumber' => '10T1G12680P',
            'draftId' => $draft->uuid,
        ];
        unset(
            $filing['passportPhoto'],
            $filing['passportBioPage'],
            $filing['birthCertificate'],
            $filing['policeCertificate'],
            $filing['proofOfAddress'],
        );

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::POST_APPROVAL, $filed->status);
        $this->assertSame(Phase::POST_APPROVAL, $filed->phase);
        $this->assertSame('10T1G12680P', $filed->cip_number);
        $this->assertNotNull($filed->post_approval_at);
        $main = $filed->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotNull($main->photo_path);
    }

    /**
     * The answer to "approved or denied?" rides with the filing whether the
     * form is completing a draft or filing afresh. Approved stands the file
     * on Approved and sends the Stage 1 notice, then the approval; Denied
     * sends the denial alone.
     */
    public function test_filing_a_post_approval_draft_as_approved_or_denied(): void
    {
        Storage::fake('local');
        \Illuminate\Support\Facades\Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        // Administrators start with provider-email copies off (Cip\Copies); this one has them on.
        $staff->forceFill(['preferences' => ['notifyProviderCopies' => true]])->save();
        $provider = $this->provider();

        $sent = fn (CipApplication $application) => \Illuminate\Support\Facades\DB::table('email_deliveries')
            ->where('related_id', $application->id)
            ->where('recipient', $staff->email)
            ->where('template', 'like', 'cip-%')
            ->orderBy('id')
            ->pluck('template')
            ->all();

        $fileDraft = function (string $number, string $first, string $outcome) use ($staff, $provider): CipApplication {
            $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => $number,
                'firstName' => $first,
                'lastName' => 'Smith',
                'gender' => 'Male',
                'dateOfBirth' => '1985-04-12',
                'countryOfBirth' => 'Lebanon',
                'countryOfResidence' => 'United Arab Emirates',
                'occupation' => 'Engineer',
                'passportNumber' => 'X'.substr($number, -7),
                'investmentType' => InvestmentType::REAL_ESTATE,
                'sponsored' => '0',
                'passportPhoto' => $this->photo(),
                'oathOfAllegiance' => [UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf')],
                'proofOfPayment' => [UploadedFile::fake()->create('payment.pdf', 40, 'application/pdf')],
            ]), ['Accept' => 'application/json'])->assertOk();

            $draft = CipApplication::query()->where('cip_number', $number)->firstOrFail();
            $this->assertSame(Status::DRAFT, $draft->status);

            $filing = $this->filing($provider) + [
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => $number,
                'draftId' => $draft->uuid,
                'outcome' => $outcome,
                'decided_at' => '2026-09-18',
                'decision_letter' => $this->cipDecisionLetterPdf(),
            ];
            $filing['firstName'] = $first;
            $filing['passportNumber'] = 'X'.substr($number, -7);
            unset(
                $filing['passportPhoto'],
                $filing['passportBioPage'],
                $filing['birthCertificate'],
                $filing['policeCertificate'],
                $filing['proofOfAddress'],
            );

            $this->actingAs($staff)
                ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
                ->assertCreated();

            return $draft->fresh();
        };

        $approved = $fileDraft('10T1G12681P', 'John', 'approved');
        $this->assertSame(Status::POST_APPROVED, $approved->status);
        $this->assertSame(Status::POST_APPROVED, $approved->decision);
        $this->assertSame('2026-09-18', $approved->decided_at->toDateString());
        $this->assertNotNull($approved->decision_letter_file_id, 'The letter is on the file.');
        $this->assertSame(['cip-status-post-approval', 'cip-granted'], $sent($approved));

        $denied = $fileDraft('10T1G12682P', 'Omar', 'denied');
        $this->assertSame(Status::POST_DENIED, $denied->status);
        $this->assertSame(Status::POST_DENIED, $denied->decision);
        $this->assertSame('2026-09-18', $denied->decided_at->toDateString());
        $this->assertNotNull($denied->decision_letter_file_id, 'The letter is on the file.');
        $this->assertSame(['cip-denied'], $sent($denied));

        // Each decision went out with its own letter attached.
        foreach ([[$approved, ' - APPROVED - '], [$denied, ' - DENIED - ']] as [$filed, $token]) {
            \Illuminate\Support\Facades\Mail::assertQueued(
                \App\Mail\Postcard::class,
                fn (\App\Mail\Postcard $mail) => str_contains((string) $mail->subjectLine, $token)
                    && str_contains((string) $mail->subjectLine, $filed->cip_number)
                    && $mail->attachment !== null
                    && $mail->attachment->id === $filed->decision_letter_file_id,
            );
        }
    }

    /**
     * Filing a draft with its decision lands whole or not at all.
     *
     * The decision stores its letter. A letter that could not be stored used
     * to stop the filing with the row already off Draft: on Post-Approval,
     * undecided, nobody told, and no longer a draft the next Add could find.
     * And the letter is asked for on the lane the filing will take, which
     * for a draft is the draft's own when the request names none.
     */
    public function test_a_post_approval_draft_filed_with_a_decision_lands_whole_or_not_at_all(): void
    {
        Storage::fake('local');
        \Illuminate\Support\Facades\Mail::fake();

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'phase' => Phase::POST_APPROVAL,
            'cipNumber' => '10T1G12695P',
            'firstName' => 'Layla',
            'lastName' => 'Smith',
            'gender' => 'Female',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1269500',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(),
            'oathOfAllegiance' => [UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf')],
            'proofOfPayment' => [UploadedFile::fake()->create('payment.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->where('cip_number', '10T1G12695P')->firstOrFail();

        $filing = function (array $extra) use ($provider, $draft): array {
            $filing = $this->filing($provider) + ['draftId' => $draft->uuid] + $extra;
            $filing['firstName'] = 'Layla';
            $filing['gender'] = 'Female';
            $filing['passportNumber'] = 'X1269500';
            unset(
                $filing['passportPhoto'],
                $filing['passportBioPage'],
                $filing['birthCertificate'],
                $filing['policeCertificate'],
                $filing['proofOfAddress'],
            );

            return $filing;
        };

        $untouched = function () use ($draft): void {
            $row = $draft->fresh();
            $this->assertSame(Status::DRAFT, $row->status, 'The row left Draft though the filing was refused.');
            $this->assertNull($row->decision);
            $this->assertNull($row->decision_letter_file_id);
            $this->assertSame(0, \Illuminate\Support\Facades\DB::table('email_deliveries')->where('related_id', $row->id)->count());
        };

        // A file sent as a PDF but named as a Word document passes the
        // upload rules and is refused where the letter is stored, which is
        // after the status has moved: the whole filing has to come back.
        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing([
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => '10T1G12695P',
                'outcome' => 'denied',
                'decided_at' => '2026-09-18',
                'decision_letter' => UploadedFile::fake()->create('letter.docx', 40, 'application/pdf'),
            ]), ['Accept' => 'application/json'])
            ->assertStatus(422)
            // Objected to by the letter's own guard, under its own key: this
            // refusal came from the store, past every rule, not from the rules.
            ->assertJsonValidationErrors(['decisionLetter'])
            ->assertJsonMissingValidationErrors(['decision_letter']);
        $untouched();

        // No phase in the body: still a post-approval filing, by the draft's
        // own, so the letter and the day are still asked for.
        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing(['outcome' => 'denied']), ['Accept' => 'application/json'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['decision_letter', 'decided_at']);
        $untouched();

        // And with them, it files.
        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing([
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => '10T1G12695P',
                'outcome' => 'denied',
                'decided_at' => '2026-09-18',
                'decision_letter' => $this->cipDecisionLetterPdf(),
            ]), ['Accept' => 'application/json'])
            ->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::POST_DENIED, $filed->status);
        $this->assertNotNull($filed->decision_letter_file_id);
    }

    /**
     * An officer completing a draft somebody else started is given the
     * file, and the hand-over must not announce the decision a second time.
     */
    public function test_an_officer_filing_a_colleagues_post_approval_draft_sends_each_email_once(): void
    {
        Storage::fake('local');
        \Illuminate\Support\Facades\Mail::fake();

        $admin = $this->user(Role::ADMINISTRATOR);
        // Administrators start with provider-email copies off (Cip\Copies); this one has them on.
        $admin->forceFill(['preferences' => ['notifyProviderCopies' => true]])->save();
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider();

        $sent = fn (CipApplication $application) => \Illuminate\Support\Facades\DB::table('email_deliveries')
            ->where('related_id', $application->id)
            ->where('recipient', $admin->email)
            ->where('template', 'like', 'cip-%')
            ->orderBy('id')
            ->pluck('template')
            ->all();

        foreach ([['10T1G12691P', 'Nadia', 'approved', Status::POST_APPROVED, ['cip-status-post-approval', 'cip-granted']],
            ['10T1G12692P', 'Idris', 'denied', Status::POST_DENIED, ['cip-denied']]] as [$number, $first, $outcome, $status, $expected]) {
            // The administrator starts it …
            $this->actingAs($admin)->post('/portal/cip/applications/draft', $this->answers($provider, [
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => $number,
                'firstName' => $first,
                'lastName' => 'Smith',
                'gender' => 'Male',
                'dateOfBirth' => '1985-04-12',
                'countryOfBirth' => 'Lebanon',
                'countryOfResidence' => 'United Arab Emirates',
                'occupation' => 'Engineer',
                'passportNumber' => 'X'.substr($number, -7),
                'investmentType' => InvestmentType::REAL_ESTATE,
                'sponsored' => '0',
                'passportPhoto' => $this->photo(),
                'oathOfAllegiance' => [UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf')],
                'proofOfPayment' => [UploadedFile::fake()->create('payment.pdf', 40, 'application/pdf')],
            ]), ['Accept' => 'application/json'])->assertOk();

            $draft = CipApplication::query()->where('cip_number', $number)->firstOrFail();

            // … and an officer files it.
            $filing = $this->filing($provider) + [
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => $number,
                'draftId' => $draft->uuid,
                'outcome' => $outcome,
                'decided_at' => '2026-09-18',
                'decision_letter' => $this->cipDecisionLetterPdf(),
            ];
            $filing['firstName'] = $first;
            $filing['passportNumber'] = 'X'.substr($number, -7);
            unset(
                $filing['passportPhoto'],
                $filing['passportBioPage'],
                $filing['birthCertificate'],
                $filing['policeCertificate'],
                $filing['proofOfAddress'],
            );

            $this->actingAs($officer)
                ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
                ->assertCreated();

            $filed = $draft->fresh();
            $this->assertSame($status, $filed->status);
            $this->assertSame($officer->id, $filed->assigned_officer_id, 'The officer who filed it holds it.');
            $this->assertSame($expected, $sent($filed), $outcome.' was not announced exactly once.');
        }
    }

    /**
     * Autosave writes the wizard's submission key onto the draft. Save
     * used to find that row and return it as if the filing had already
     * happened — still a Draft. Completing it is what the press was for.
     */
    public function test_filing_with_the_drafts_submission_key_moves_it_to_new(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $key = 'wizard-key-pre';

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'submissionId' => $key,
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
            'birthCertificate' => [UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->first();
        $this->assertSame(Status::DRAFT, $draft->status);

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $this->filing($provider) + ['submissionId' => $key], ['Accept' => 'application/json'])
            ->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::NEW, $filed->status);
        $this->assertSame(1, CipApplication::query()->count());

        // A retry after a timeout is the application already filed, not a second one.
        $this->actingAs($staff)
            ->post('/portal/cip/applications', $this->filing($provider) + ['submissionId' => $key], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('application.id', $filed->uuid)
            ->assertJsonPath('application.status', Status::NEW);
    }

    public function test_filing_a_post_approval_draft_with_its_submission_key_moves_it_to_post_approval(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $key = 'wizard-key-post';

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'phase' => Phase::POST_APPROVAL,
            'submissionId' => $key,
            'cipNumber' => '10T1G12681P',
            'firstName' => 'John',
            'lastName' => 'Smith',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'countryOfResidence' => 'United Arab Emirates',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(),
            'passportBioPage' => [UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf')],
            'birthCertificate' => [UploadedFile::fake()->create('birth.pdf', 40, 'application/pdf')],
            'oathOfAllegiance' => [UploadedFile::fake()->create('oath.pdf', 40, 'application/pdf')],
            'proofOfPayment' => [UploadedFile::fake()->create('payment.pdf', 40, 'application/pdf')],
        ]), ['Accept' => 'application/json'])->assertOk();

        $this->actingAs($staff)->post(
            '/portal/cip/applications',
            $this->filing($provider) + [
                'phase' => Phase::POST_APPROVAL,
                'cipNumber' => '10T1G12681P',
                'submissionId' => $key,
            ],
            ['Accept' => 'application/json'],
        )->assertCreated();

        $filed = CipApplication::query()->first();
        $this->assertSame(Status::POST_APPROVAL, $filed->status);
        $this->assertSame(Phase::POST_APPROVAL, $filed->phase);
        $this->assertSame('10T1G12681P', $filed->cip_number);
    }

    /**
     * Throwing a draft away puts the application in the recycle bin.
     *
     * The client folder stays, because that folder is the person. The
     * application's own paper goes with the file, and restoring the file
     * brings that paper back.
     */
    public function test_discarding_a_draft_puts_it_in_the_recycle_bin(): void
    {
        Storage::fake('local');

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', $this->answers($provider, [
            'passportPhoto' => UploadedFile::fake()->image('face.jpg', 600, 600),
        ]), ['Accept' => 'application/json'])->assertOk();

        $draft = CipApplication::query()->with('people')->first();
        $clientFolderId = $draft->folder_id;
        $personFolderId = $draft->people->first()?->folder_id;
        $this->assertNotNull($clientFolderId, 'A draft holding scans has a folder.');
        $this->assertNotNull($personFolderId);
        $this->assertNotSame($clientFolderId, $personFolderId);

        $this->actingAs($staff)
            ->deleteJson('/portal/cip/applications/draft?application='.$draft->uuid)
            ->assertOk();

        $this->assertNull(CipApplication::query()->find($draft->id));
        $this->assertTrue(CipApplication::withTrashed()->find($draft->id)->trashed());

        $this->assertNotNull(Folder::query()->find($clientFolderId), 'The client folder stays.');
        $this->assertNull(Folder::query()->find($personFolderId));
        $this->assertNotNull(Folder::withTrashed()->find($personFolderId));

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$draft->uuid.'/restore')
            ->assertOk();

        $this->assertNotNull(CipApplication::query()->find($draft->id));
        $this->assertNotNull(Folder::query()->find($personFolderId));
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
        $this->assertSame('JOANNE', CipApplication::query()->first()
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
        $this->assertSame('PRE', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?phase='.Phase::PRE_APPROVAL)
            ->json('draft.answers.firstName'));
        $this->assertSame('POST', $this->actingAs($staff)
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
        $this->assertSame(1, CipApplication::withTrashed()->count());
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
        $this->assertSame(1, CipApplication::withTrashed()->count());
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

        $this->actingAs($staff)->post('/portal/cip/applications', $this->filing($provider), ['Accept' => 'application/json'])->assertCreated();

        $this->assertSame(1, CipApplication::query()->count());
        $filed = CipApplication::query()->first();
        $this->assertSame(Status::NEW, $filed->status);
        // The same row, so the number it was known by while drafting stands.
        $this->assertSame($draftNumber, $filed->internal_number);
    }

    public function test_filing_a_draft_still_demands_required_documents(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();

        $incomplete = $this->filing($provider);
        unset($incomplete['bankReferenceLetter'], $incomplete['netWorthBreakdown']);

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $incomplete, ['Accept' => 'application/json'])
            ->assertStatus(422);

        $this->assertSame(Status::DRAFT, CipApplication::query()->first()->status);
    }

    /**
     * A draft is not a duplicate of itself.
     *
     * The bug this pins, reported from the screen: the wizard autosaves into a
     * draft row, so by the time Add was pressed the applicant WAS already on
     * file — as the very draft being filed. The reader was shown "TEST 4
     * FRANCIS already has application IGA26-00002" and asked to confirm a
     * duplicate of their own unfinished work.
     */
    public function test_filing_a_draft_is_not_reported_as_a_duplicate_of_itself(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider))->assertOk();

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $this->filing($provider), ['Accept' => 'application/json'])
            // Not 409: there is nothing to confirm.
            ->assertCreated();

        $this->assertSame(1, CipApplication::query()->count());
    }

    /**
     * Nor is somebody else's draft.
     *
     * A draft is an application nobody has filed. Warning that an applicant is
     * "already on file" because a colleague started typing their name would be
     * a duplicate warning about work that does not exist yet.
     */
    public function test_another_readers_draft_is_not_a_duplicate(): void
    {
        $mine = $this->user(Role::ADMINISTRATOR);
        $theirs = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        // Somebody else is halfway through the same applicant.
        $this->save($theirs, $this->answers($provider))->assertOk();

        $this->actingAs($mine)
            ->post('/portal/cip/applications', $this->filing($provider), ['Accept' => 'application/json'])
            ->assertCreated();
    }

    /** A genuinely second filing is still stopped. */
    public function test_a_real_duplicate_is_still_caught(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $this->filing($provider), ['Accept' => 'application/json'])
            ->assertCreated();

        // The same person again, with no draft behind it this time.
        $this->actingAs($staff)
            ->post('/portal/cip/applications', $this->filing($provider), ['Accept' => 'application/json'])
            ->assertStatus(409)
            ->assertJsonPath('duplicate.name', 'JOHN SMITH');
    }

    /**
     * A draft opened from the table is addressed by name.
     *
     * Without this the save landed on whatever this reader's newest draft of
     * the phase happened to be, so opening an older draft and typing into it
     * wrote the answers into a different application.
     */
    public function test_a_named_draft_is_the_one_that_is_saved(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        // Two drafts of the same phase, the second one newer.
        $this->save($staff, $this->answers($provider, ['firstName' => 'First']))->assertOk();
        $older = CipApplication::query()->first();
        $older->forceFill(['status' => Status::DRAFT])->save();
        $this->actingAs($staff)->postJson('/portal/cip/applications/draft', [
            'providerId' => $provider->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'firstName' => 'Second',
        ])->assertOk();

        // Naming the older one writes to the older one.
        $this->actingAs($staff)->postJson(
            '/portal/cip/applications/draft?application='.$older->uuid,
            $this->answers($provider, ['firstName' => 'Corrected']),
        )->assertOk();

        $this->assertSame('CORRECTED', $older->fresh()
            ->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
    }

    /** Somebody else's draft is not addressable, however it is named. */
    /**
     * A draft is the firm's, not a private note of whoever opened the form.
     *
     * A colleague who opens a draft from the table types into THAT row. Their
     * autosave used to start a private copy with none of the scans, and
     * their Add was refused as not theirs; the form looked empty to anyone
     * but the person who started it.
     */
    public function test_a_named_draft_is_edited_by_a_colleague_who_may_file(): void
    {
        $mine = $this->user(Role::ADMINISTRATOR);
        $theirs = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($theirs, $this->answers($provider, ['firstName' => 'Theirs']))->assertOk();
        $hers = CipApplication::query()->first();

        $this->actingAs($mine)->postJson(
            '/portal/cip/applications/draft?application='.$hers->uuid,
            $this->answers($provider, ['firstName' => 'Mine']),
        )->assertOk()->assertJsonPath('draft.id', $hers->uuid);

        $this->assertSame('MINE', $hers->fresh()
            ->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
        $this->assertSame(1, CipApplication::query()->where('status', Status::DRAFT)->count());
    }

    /**
     * A draft is filed under the firm its form names.
     *
     * The wizard has always offered the Service provider select on a draft
     * and the first autosave has always honoured it. Every save after that
     * dropped the answer: the reader went on seeing the firm they had
     * switched to while the row, its number and its folder stayed with the
     * first one, and filing filed it there.
     */
    public function test_a_draft_follows_the_firm_its_form_names_and_is_numbered_under_it(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');
        $yy = now()->format('y');

        // No name yet, so the hub client is called after the file.
        $first = $this->save($staff, [
            'providerId' => $galaxy->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'countryOfResidence' => 'United Arab Emirates',
        ])->assertOk()->json('draft');
        $this->assertSame("GAL{$yy}-00001", $first['number']);

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $standIn = $draft->client?->name;
        $uid = $draft->client?->uid;

        // The form names the new firm, and says which firm it believes the
        // draft is with: that belief being true is what makes this a change
        // the reader made rather than a form that is merely out of date.
        $second = $this->actingAs($staff)->postJson('/portal/cip/applications/draft?application='.$first['id'], [
            'providerId' => $bluemina->uuid,
            'providerWas' => $galaxy->uuid,
            'phase' => Phase::PRE_APPROVAL,
            'countryOfResidence' => 'United Arab Emirates',
        ])->assertOk()->json('draft');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame($bluemina->uuid, $second['answers']['providerId']);
        $this->assertSame("BLU{$yy}-00001", $second['number']);
        // The save says what the table row draws now, so the table behind
        // the form is right the moment the reader goes back to it.
        $this->assertSame('BLU Provider', $second['provider']);
        $this->assertSame('BLU', $second['providerCode']);
        $this->assertSame("BLU{$yy}-00001", $second['displayNumber']);
        $this->assertNotNull($second['clientUid']);
        $this->assertSame(1, CipApplication::count());

        $draft->refresh();
        $this->assertSame($bluemina->id, $draft->provider_id);
        $this->assertSame(Status::DRAFT, $draft->status);
        $this->assertSame($bluemina->company_id, $draft->client?->referred_by_company_id);

        // The stand-in name follows the number; the address does not.
        $this->assertSame("Application GAL{$yy}-00001", $standIn);
        $this->assertSame("Application BLU{$yy}-00001", $draft->client->fresh()->name);
        $this->assertSame($uid, $draft->client->fresh()->uid);

        // Galaxy's next file is its next number, not the one that left.
        $this->assertSame("GAL{$yy}-00002", Applications::create($galaxy, $staff)->internal_number);
    }

    public function test_filing_a_draft_files_it_under_the_firm_the_form_names(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');
        $yy = now()->format('y');

        $this->save($staff, $this->answers($galaxy))->assertOk();
        $draft = CipApplication::query()->firstOrFail();
        $this->assertSame("GAL{$yy}-00001", $draft->internal_number);

        // Add pressed before the autosave caught the change of firm.
        $filing = $this->filing($bluemina);
        $filing['draftId'] = $draft->uuid;
        $filing['providerWas'] = $galaxy->uuid;

        $filed = $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('application');

        $this->assertSame($draft->uuid, $filed['id']);
        $this->assertSame($bluemina->uuid, $filed['providerId']);
        $this->assertSame("BLU{$yy}-00001", $filed['internalNumber']);
        $this->assertSame(1, CipApplication::count());
    }

    /**
     * A form that is behind moves nothing.
     *
     * The form posts its firm on every autosave. "Differs from the row" is
     * therefore not "the reader changed it": it is just as likely a form
     * opened before somebody else moved the draft, and following it moved
     * the draft straight back, a number spent at each firm per keystroke.
     * The draft moves only when the firm the form believes it is with is
     * the firm it is with.
     */
    public function test_a_form_opened_before_a_move_does_not_move_the_draft_back(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $author = $this->user(Role::REVIEWING_OFFICER);
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');
        $yy = now()->format('y');

        $first = $this->save($author, $this->answers($galaxy, ['submissionId' => 'key-1']))->assertOk()->json('draft');
        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();

        // An administrator moves the draft while the author's form is open.
        $this->actingAs($admin)->postJson('/portal/cip/applications/'.$draft->uuid.'/provider', [
            'providerId' => $bluemina->uuid, 'confirm' => true,
        ])->assertOk();
        $this->assertSame("BLU{$yy}-00001", $draft->fresh()->internal_number);

        // The author types: their form still names Galaxy, and believes Galaxy.
        $behind = $this->actingAs($author)->postJson('/portal/cip/applications/draft?application='.$draft->uuid, $this->answers($galaxy, [
            'submissionId' => 'key-1', 'providerWas' => $galaxy->uuid, 'firstName' => 'Johnny',
        ]))->assertOk()->json('draft');

        // The answers landed; the draft did not move, and the reply says
        // where it is so the form can catch up.
        $this->assertSame($bluemina->id, $draft->fresh()->provider_id);
        $this->assertSame("BLU{$yy}-00001", $draft->fresh()->internal_number);
        $this->assertSame($bluemina->uuid, $behind['answers']['providerId']);
        $this->assertSame('JOHNNY', $behind['answers']['firstName']);
        $this->assertSame(1, $draft->events()->where('action', \App\Models\CipEvent::ACTION_PROVIDER_TRANSFERRED)->count());

        // Nor does a save that says nothing about what it believes.
        $this->actingAs($author)->postJson('/portal/cip/applications/draft?application='.$draft->uuid, $this->answers($galaxy, [
            'submissionId' => 'key-1',
        ]))->assertOk();
        $this->assertSame($bluemina->id, $draft->fresh()->provider_id);

        // Caught up, the same reader can still change the firm on purpose.
        $this->actingAs($author)->postJson('/portal/cip/applications/draft?application='.$draft->uuid, $this->answers($galaxy, [
            'submissionId' => 'key-1', 'providerWas' => $bluemina->uuid,
        ]))->assertOk();
        $this->assertSame($galaxy->id, $draft->fresh()->provider_id);
        $this->assertSame("GAL{$yy}-00002", $draft->fresh()->internal_number);
    }

    /**
     * Its author cannot pull back a draft moved out of their reach.
     *
     * Drafts are also found by their author's submission key, with no
     * regard to whether the author can still see the row. That was harmless
     * while a save wrote answers only. A Galaxy contact whose draft an
     * administrator gave to Bluemina must not take it back by typing.
     */
    public function test_an_author_cannot_pull_back_a_draft_moved_out_of_their_reach(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');
        $contact = $this->user(Role::CLIENT);
        \App\Models\CompanyMember::create([
            'company_id' => $galaxy->company_id, 'user_id' => $contact->id,
            'name' => $contact->name, 'email' => $contact->email,
            'role' => 'member', 'status' => \App\Models\CompanyMember::STATUS_ACTIVE,
        ]);
        $yy = now()->format('y');

        $first = $this->save($contact, $this->answers($galaxy, ['submissionId' => 'key-9']))->assertOk()->json('draft');
        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();

        $this->actingAs($admin)->postJson('/portal/cip/applications/'.$draft->uuid.'/provider', [
            'providerId' => $bluemina->uuid, 'confirm' => true,
        ])->assertOk();
        $this->actingAs($contact)->getJson('/portal/cip/applications/'.$draft->uuid)->assertNotFound();

        // Every shape of save the open form can make, each claiming to
        // believe whatever would make the move look like the reader's own.
        foreach ([$galaxy->uuid, $bluemina->uuid] as $believed) {
            $this->actingAs($contact)->postJson('/portal/cip/applications/draft?application='.$draft->uuid, $this->answers($galaxy, [
                'submissionId' => 'key-9', 'providerWas' => $believed,
            ]));
            $this->actingAs($contact)->postJson('/portal/cip/applications/draft', $this->answers($galaxy, [
                'submissionId' => 'key-9', 'providerWas' => $believed,
            ]));
        }

        $this->assertSame($bluemina->id, $draft->fresh()->provider_id);
        $this->assertSame("BLU{$yy}-00001", $draft->fresh()->internal_number);
        $this->assertSame(1, $draft->events()->where('action', \App\Models\CipEvent::ACTION_PROVIDER_TRANSFERRED)->count());
    }

    /**
     * A firm reached by naming a parent is not the reader's choice of firm.
     *
     * The draft controller numbers a NEW Add-On under its main
     * application's firm. Handing that firm to an existing draft as though
     * the reader had picked it let somebody who may file under one firm
     * only put an ordinary draft under another, by posting an Add-On's
     * fields at it.
     */
    public function test_naming_a_parent_does_not_move_an_ordinary_draft_to_that_parents_firm(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');

        // A granted file at Bluemina, which a parent lookup can find.
        $parent = Applications::create($bluemina, $admin, ['investment_type' => InvestmentType::REAL_ESTATE]);
        CipPerson::create([
            'application_id' => $parent->id, 'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'CHEN', 'last_name' => 'WEI',
        ]);
        $parent->forceFill([
            'status' => Status::GRANTED, 'decision' => CipApplication::DECISION_GRANTED,
            'cip_number' => '10T1BLU01P', 'cor_number' => 'COR-7',
        ])->save();

        $first = $this->save($admin, $this->answers($galaxy, ['submissionId' => 'key-5']))->assertOk()->json('draft');
        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();

        $this->actingAs($admin)->postJson('/portal/cip/applications/draft', [
            'phase' => Phase::ADD_ON,
            'submissionId' => 'key-5',
            'providerWas' => $galaxy->uuid,
            'parentCipNumber' => '10T1BLU01P',
            'parentCorNumber' => 'COR-7',
            'firstName' => 'John',
            'lastName' => 'Smith',
        ]);

        $this->assertSame($galaxy->id, $draft->fresh()->provider_id);
        $this->assertSame($first['number'], $draft->fresh()->internal_number);
    }

    /** A firm the reader may not file under moves nothing. */
    public function test_a_provider_contact_cannot_move_a_draft_to_a_firm_that_is_not_theirs(): void
    {
        $galaxy = $this->provider('GAL');
        $bluemina = $this->provider('BLU');
        $contact = $this->user(Role::CLIENT);
        \App\Models\CompanyMember::create([
            'company_id' => $galaxy->company_id, 'user_id' => $contact->id,
            'name' => $contact->name, 'email' => $contact->email,
            'role' => 'member', 'status' => \App\Models\CompanyMember::STATUS_ACTIVE,
        ]);

        $first = $this->save($contact, $this->answers($galaxy))->assertOk()->json('draft');

        $this->actingAs($contact)->postJson(
            '/portal/cip/applications/draft?application='.$first['id'],
            $this->answers($bluemina, ['providerWas' => $galaxy->uuid]),
        )->assertStatus(422);

        $draft = CipApplication::query()->where('uuid', $first['id'])->firstOrFail();
        $this->assertSame($galaxy->id, $draft->provider_id);
        $this->assertSame($first['number'], $draft->internal_number);
    }

    public function test_a_named_draft_out_of_reach_is_not_written_to(): void
    {
        $theirs = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $this->save($theirs, $this->answers($provider, ['firstName' => 'Theirs']))->assertOk();
        $hers = CipApplication::query()->first();

        // A contact of a different firm cannot see the draft at all, so a
        // save naming it starts a draft of their own under their own firm.
        $other = $this->provider('BLU');
        $stranger = $this->user(Role::CLIENT);
        \App\Models\CompanyMember::create([
            'company_id' => $other->company_id, 'user_id' => $stranger->id,
            'name' => $stranger->name, 'email' => $stranger->email,
            'role' => 'member', 'status' => \App\Models\CompanyMember::STATUS_ACTIVE,
        ]);

        $this->actingAs($stranger)->postJson(
            '/portal/cip/applications/draft?application='.$hers->uuid,
            $this->answers($other, ['firstName' => 'Mine']),
        )->assertOk();

        $this->assertSame('THEIRS', $hers->fresh()
            ->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->first_name);
        $this->assertSame(2, CipApplication::query()->where('status', Status::DRAFT)->count());
    }

    public function test_a_colleague_can_file_a_draft_somebody_else_started(): void
    {
        $theirs = $this->user(Role::REVIEWING_OFFICER);
        $mine = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($theirs, $this->answers($provider))->assertOk();
        $draft = CipApplication::query()->first();

        $this->actingAs($mine)
            ->post('/portal/cip/applications/'.$draft->uuid, $this->filing($provider), ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('application.id', $draft->uuid)
            ->assertJsonPath('application.status', Status::NEW);

        $this->assertSame(1, CipApplication::count());
    }

    /** Filing a reopened draft completes that row, not the newest one. */
    public function test_filing_names_the_draft_it_completes(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, ['firstName' => 'Older']))->assertOk();
        $older = CipApplication::query()->first();
        /*
         * A second draft that must be left alone. Started directly rather
         * than through the endpoint, which keeps one draft per phase — this
         * is the two-tabs case that rule does not cover.
         */
        $newer = Applications::create($provider, $staff, [], Status::DRAFT);

        $this->actingAs($staff)->post(
            '/portal/cip/applications',
            $this->filing($provider) + ['draftId' => $older->uuid],
            ['Accept' => 'application/json'],
        )->assertCreated();

        $this->assertSame(Status::NEW, $older->fresh()->status);
        $this->assertSame(1, CipApplication::query()->where('status', Status::DRAFT)->count());
    }

    /**
     * A draft names who is typing it.
     *
     * Filing already claims an officer; a leftover draft used to sit as
     * Unassigned beside a created_by the table never drew. The Assigned To
     * column and the hub list both name the author while the status stays
     * DRAFT — unfinished typing is not nobody's work.
     */
    public function test_an_officer_who_starts_a_draft_is_given_it(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider();

        $this->save($officer, $this->answers($provider))->assertOk();

        $draft = CipApplication::query()->firstOrFail();

        $this->assertSame(Status::DRAFT, $draft->status);
        $this->assertSame($officer->id, $draft->assigned_officer_id);
        $this->assertTrue(
            CipApplicationAssignment::query()
                ->where('application_id', $draft->id)
                ->where('user_id', $officer->id)
                ->where('status', CipApplicationAssignment::STATUS_ACTIVE)
                ->exists(),
        );
        $this->assertNotNull($draft->client_id);
        $this->assertTrue(
            $draft->client->assignments()->live()->where('user_id', $officer->id)->exists(),
        );

        $row = $this->actingAs($officer)
            ->getJson('/portal/cip/applications/'.$draft->uuid)
            ->assertOk()
            ->json('application');
        $this->assertSame($officer->name, $row['assignedTo'][0]['name'] ?? null);
    }

    /** An administrator typing a draft is named the same way. */
    public function test_an_administrator_who_starts_a_draft_is_named_on_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($admin, $this->answers($provider))->assertOk();

        $draft = CipApplication::query()->firstOrFail();
        $this->assertSame(Status::DRAFT, $draft->status);
        $this->assertSame($admin->id, $draft->assigned_officer_id);
        $this->assertSame(
            CipAccess::REVIEWING_OFFICER,
            CipApplicationAssignment::query()
                ->where('application_id', $draft->id)
                ->where('status', CipApplicationAssignment::STATUS_ACTIVE)
                ->value('role'),
        );

        $row = $this->actingAs($admin)
            ->getJson('/portal/cip/applications/'.$draft->uuid)
            ->assertOk()
            ->json('application');
        $this->assertSame($admin->name, $row['assignedTo'][0]['name'] ?? null);
    }

    /**
     * Filing an admin's draft clears the authorship hold.
     *
     * An administrator filing on somebody's behalf is routing, not reviewing.
     * Naming them on the draft must not leave them holding New Applications.
     */
    public function test_filing_an_administrators_draft_leaves_it_unassigned(): void
    {
        Storage::fake('local');

        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($admin, $this->answers($provider))->assertOk();
        $draft = CipApplication::query()->firstOrFail();
        $this->assertSame($admin->id, $draft->assigned_officer_id);

        $this->actingAs($admin)->post(
            '/portal/cip/applications',
            $this->filing($provider) + ['draftId' => $draft->uuid],
            ['Accept' => 'application/json'],
        )->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::NEW, $filed->status);
        $this->assertNull($filed->assigned_officer_id);
        $this->assertSame(0, CipApplicationAssignment::query()
            ->where('application_id', $filed->id)
            ->where('status', CipApplicationAssignment::STATUS_ACTIVE)
            ->count());
    }

    /**
     * An officer who drafts and then files still holds the file.
     *
     * Claiming at draft and again at file must not end and re-open the
     * assignment — the same person keeps it, and the status moves out of NEW.
     */
    public function test_filing_an_officers_draft_keeps_them_assigned(): void
    {
        Storage::fake('local');

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $provider = $this->provider();

        $this->save($officer, $this->answers($provider))->assertOk();
        $draft = CipApplication::query()->firstOrFail();
        $assignmentId = CipApplicationAssignment::query()
            ->where('application_id', $draft->id)
            ->where('status', CipApplicationAssignment::STATUS_ACTIVE)
            ->value('id');

        $this->actingAs($officer)->post(
            '/portal/cip/applications',
            $this->filing($provider) + ['draftId' => $draft->uuid],
            ['Accept' => 'application/json'],
        )->assertCreated();

        $filed = $draft->fresh();
        $this->assertSame(Status::REVIEW_APPLICATION, $filed->status);
        $this->assertSame($officer->id, $filed->assigned_officer_id);
        $this->assertSame(
            $assignmentId,
            CipApplicationAssignment::query()
                ->where('application_id', $filed->id)
                ->where('status', CipApplicationAssignment::STATUS_ACTIVE)
                ->value('id'),
            'Filing reuses the draft claim rather than ending and rewriting it.',
        );
    }

    /** The whole form, as the wizard posts it. */
    private function filing(CipProvider $provider): array
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
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
        ], $this->cipRequiredDocumentFiles(
            \App\Support\Cip\ApplicantType::PRINCIPAL_APPLICANT,
            Phase::PRE_APPROVAL,
            'Male',
            InvestmentType::REAL_ESTATE,
        ));
    }

    private function photo(int $width = 600): UploadedFile
    {
        $img = imagecreatetruecolor($width, $width);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 210, 220));
        $path = tempnam(sys_get_temp_dir(), 'cip').'.jpg';
        imagejpeg($img, $path, 90);

        return new UploadedFile($path, 'photo.jpg', 'image/jpeg', null, true);
    }

    /**
     * Two draft creates racing on one submission key must not 500.
     *
     * Filing already catches the unique index and returns the winner. Draft
     * create used to let the loser explode as "Server Error", which turned
     * the form's autosave off so Save as draft then said the form was not a
     * draft at all.
     */
    public function test_a_racing_draft_create_updates_the_existing_row(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $this->save($staff, $this->answers($provider, [
            'submissionId' => 'race-key',
            'firstName' => 'First',
            'lastName' => 'Save',
        ]))->assertOk();

        $this->assertSame(1, CipApplication::query()->where('status', Status::DRAFT)->count());

        // Name a uuid that is not this draft, so mine() misses and create
        // hits the unique index — the same shape as two creates racing.
        $this->save($staff, $this->answers($provider, [
            'application' => (string) \Illuminate\Support\Str::uuid(),
            'submissionId' => 'race-key',
            'firstName' => 'Second',
            'lastName' => 'Save',
        ]))->assertOk();

        $this->assertSame(1, CipApplication::query()->where('status', Status::DRAFT)->count());
        $draft = CipApplication::query()->where('submission_key', 'race-key')->firstOrFail();
        $main = $draft->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertSame('SECOND', $main->first_name);
    }

    /**
     * A new application must not be written onto a draft that is already saved.
     *
     * Create New Application leaves the saved draft off the screen, then the
     * first autosave used to land on that row anyway. The names changed. The
     * photo and the documents did not, because those slots were already
     * filled, so the person just entered wore the draft person's face and scans.
     */
    public function test_a_new_submission_keeps_its_own_photo_and_documents(): void
    {
        Storage::fake('local');
        Storage::fake(config('filesystems.avatar_disk', 'public'));

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $principalDocs = fn (string $bio) => array_merge(
            $this->cipRequiredDocumentFiles(
                \App\Support\Cip\ApplicantType::PRINCIPAL_APPLICANT,
                Phase::PRE_APPROVAL,
                'Male',
                InvestmentType::REAL_ESTATE,
            ),
            ['passportBioPage' => [UploadedFile::fake()->create($bio, 40, 'application/pdf')]],
        );
        $childDocs = fn (string $bio) => array_merge(
            $this->cipRequiredDocumentFiles(
                \App\Support\Cip\ApplicantType::DEPENDENT_UNDER_16,
                Phase::PRE_APPROVAL,
            ),
            ['passportBioPage' => [UploadedFile::fake()->create($bio, 30, 'application/pdf')]],
        );

        $this->actingAs($staff)->post('/portal/cip/applications/draft', array_merge($this->answers($provider, [
            'submissionId' => 'draft-person',
            'firstName' => 'Draft',
            'lastName' => 'Person',
            'gender' => 'Male',
            'dateOfBirth' => '1980-01-01',
            'countryOfBirth' => 'Lebanon',
            'occupation' => 'Engineer',
            'passportNumber' => 'D1111111',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(600),
            'dependents' => [[
                'firstName' => 'Draft',
                'lastName' => 'Child',
                'dateOfBirth' => '2014-01-02',
                'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                'passportPhoto' => $this->photo(610),
            ] + $childDocs('draft-child.pdf')],
        ]), $principalDocs('draft-bio.pdf')), ['Accept' => 'application/json'])->assertOk();

        $saved = CipApplication::query()->where('submission_key', 'draft-person')->firstOrFail();
        $savedMain = $saved->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $savedChild = $saved->people->firstWhere('role', CipPerson::ROLE_DEPENDENT);
        $savedPhoto = $savedMain->photo_path;
        $savedBioId = $savedMain->documents()->where('type', 'passport_bio_page')->value('file_id');
        $savedChildPhoto = $savedChild->photo_path;

        $this->actingAs($staff)->post('/portal/cip/applications/draft', array_merge($this->answers($provider, [
            'submissionId' => 'new-person',
            'firstName' => 'Fesa',
            'lastName' => 'Butbouten',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(640),
            'dependents' => [[
                'firstName' => 'Fesa',
                'lastName' => 'Child',
                'dateOfBirth' => '2016-03-03',
                'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
                'passportPhoto' => $this->photo(650),
            ] + $childDocs('fesa-child.pdf')],
        ]), $principalDocs('fesa-bio.pdf')), ['Accept' => 'application/json'])->assertOk();

        $this->assertSame(2, CipApplication::query()->where('status', Status::DRAFT)->count());

        $savedMain = $saved->fresh()->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $savedChild = $saved->fresh()->people->firstWhere('role', CipPerson::ROLE_DEPENDENT);
        $this->assertSame('DRAFT', $savedMain->first_name);
        $this->assertSame($savedPhoto, $savedMain->photo_path);
        $this->assertSame($savedBioId, $savedMain->documents()->where('type', 'passport_bio_page')->value('file_id'));
        $this->assertSame($savedChildPhoto, $savedChild->photo_path);

        $entered = CipApplication::query()->where('submission_key', 'new-person')->firstOrFail();
        $enteredMain = $entered->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $enteredChild = $entered->people->firstWhere('role', CipPerson::ROLE_DEPENDENT);
        $this->assertSame('FESA', $enteredMain->first_name);
        $this->assertNotSame($savedPhoto, $enteredMain->photo_path);
        $this->assertNotSame($savedBioId, $enteredMain->documents()->where('type', 'passport_bio_page')->value('file_id'));
        $this->assertNotSame($savedChildPhoto, $enteredChild->photo_path);
        $this->assertNotNull($enteredChild->documents()->where('type', 'passport_bio_page')->value('file_id'));

        $filing = $this->cipWithoutUploads($this->filing($provider));
        $filing['submissionId'] = 'new-person';
        $filing['firstName'] = 'Fesa';
        $filing['lastName'] = 'Butbouten';
        $filing['dependents'] = [[
            'id' => $enteredChild->uuid,
            'firstName' => 'Fesa',
            'lastName' => 'Child',
            'dateOfBirth' => '2016-03-03',
            'relationship' => CipPerson::RELATIONSHIP_QUALIFIED,
        ]];

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated();

        $this->assertSame(Status::NEW, $entered->fresh()->status);
        $this->assertSame(Status::DRAFT, $saved->fresh()->status);
        $filedMain = $entered->fresh()->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $this->assertNotSame($savedPhoto, $filedMain->photo_path);
        $this->assertSame(
            $enteredMain->documents()->where('type', 'passport_bio_page')->value('file_id'),
            $filedMain->documents()->where('type', 'passport_bio_page')->value('file_id'),
        );
        $this->assertSame($savedPhoto, $saved->fresh()->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->photo_path);
    }

    /**
     * The Unit's number is part of the draft, and filing keeps it on that row.
     */
    public function test_a_post_approval_draft_keeps_the_cip_number_that_was_typed(): void
    {
        Storage::fake('local');
        Storage::fake(config('filesystems.avatar_disk', 'public'));

        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();
        $docs = fn () => $this->cipRequiredDocumentFiles(
            \App\Support\Cip\ApplicantType::PRINCIPAL_APPLICANT,
            Phase::POST_APPROVAL,
            'Male',
            InvestmentType::REAL_ESTATE,
        );

        $this->actingAs($staff)->post('/portal/cip/applications/draft', array_merge($this->answers($provider, [
            'phase' => Phase::POST_APPROVAL,
            'submissionId' => 'draft-person',
            'cipNumber' => '10T1G10000P',
            'firstName' => 'Draft',
            'lastName' => 'Person',
            'gender' => 'Male',
            'dateOfBirth' => '1980-01-01',
            'countryOfBirth' => 'Lebanon',
            'occupation' => 'Engineer',
            'passportNumber' => 'D1111111',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(600),
        ]), $docs()), ['Accept' => 'application/json'])->assertOk();

        $this->actingAs($staff)->post('/portal/cip/applications/draft', array_merge($this->answers($provider, [
            'phase' => Phase::POST_APPROVAL,
            'submissionId' => 'new-person',
            'cipNumber' => '10T1G12680P',
            'firstName' => 'Fesa',
            'lastName' => 'Butbouten',
            'gender' => 'Male',
            'dateOfBirth' => '1985-04-12',
            'countryOfBirth' => 'Lebanon',
            'occupation' => 'Engineer',
            'passportNumber' => 'X1234567',
            'investmentType' => InvestmentType::REAL_ESTATE,
            'sponsored' => '0',
            'passportPhoto' => $this->photo(640),
        ]), $docs()), ['Accept' => 'application/json'])->assertOk();

        $saved = CipApplication::query()->where('submission_key', 'draft-person')->firstOrFail();
        $entered = CipApplication::query()->where('submission_key', 'new-person')->firstOrFail();
        $this->assertSame('10T1G10000P', $saved->cip_number);
        $this->assertSame('10T1G12680P', $entered->cip_number);
        $this->assertSame('10T1G12680P', $this->actingAs($staff)
            ->getJson('/portal/cip/applications/draft?application='.$entered->uuid)
            ->json('draft.answers.cipNumber'));

        $savedPhoto = $saved->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->photo_path;

        $filing = $this->cipWithoutUploads($this->filing($provider));
        $filing['phase'] = Phase::POST_APPROVAL;
        $filing['submissionId'] = 'new-person';
        $filing['firstName'] = 'Fesa';
        $filing['lastName'] = 'Butbouten';
        unset($filing['cipNumber']);

        $this->actingAs($staff)
            ->post('/portal/cip/applications', $filing, ['Accept' => 'application/json'])
            ->assertCreated();

        $filed = $entered->fresh();
        $this->assertSame(Status::POST_APPROVAL, $filed->status);
        $this->assertSame('10T1G12680P', $filed->cip_number);
        $this->assertSame(Status::DRAFT, $saved->fresh()->status);
        $this->assertSame('10T1G10000P', $saved->fresh()->cip_number);
        $this->assertSame(
            $savedPhoto,
            $saved->fresh()->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->photo_path,
        );
        $this->assertNotSame(
            $savedPhoto,
            $filed->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT)->photo_path,
        );
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
