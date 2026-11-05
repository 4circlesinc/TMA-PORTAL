<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyLocation;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Contacts;
use App\Support\Cip\FolderAccess;
use App\Support\Cip\Notices;
use App\Support\Cip\Status;
use App\Support\Companies\CompanyLocations;
use App\Support\Companies\NotificationEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * A branch sees the applications assigned to it. The main office keeps the
 * firm book. A service provider admin or an administrator assigns the file
 * by naming a person at that office.
 */
class CipBranchAssignmentTest extends TestCase
{
    use RefreshDatabase;

    private Company $company;

    private CipProvider $provider;

    private CompanyLocation $main;

    private CompanyLocation $north;

    private CompanyLocation $south;

    private User $admin;

    private User $spAdmin;

    private User $firmUser;

    private User $northUser;

    private User $southUser;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Mail::fake();
        ApplicationScope::forget();
        FolderAccess::forget();

        $this->company = Company::create(['uid' => 'gcc', 'name' => 'Global Citizen Consultants']);
        $this->provider = CipProvider::create([
            'name' => 'GLOBAL CITIZEN CONSULTANTS',
            'code' => 'GCC',
            'company_id' => $this->company->id,
        ]);
        $this->admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $this->spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, 'gil@gcc.example', 'Gil Admin');
        $this->firmUser = $this->user(Role::CLIENT, 'firm@gcc.example', 'Firm User');
        $this->northUser = $this->user(Role::CLIENT, 'north@gcc.example', 'North User');
        $this->southUser = $this->user(Role::CLIENT, 'south@gcc.example', 'South User');

        $this->main = CompanyLocations::ensureMain($this->company);
        $this->north = CompanyLocations::addBranch($this->company, 'North', $this->spAdmin);
        $this->south = CompanyLocations::addBranch($this->company, 'South', $this->spAdmin);

        $this->seat($this->spAdmin, $this->main);
        $this->seat($this->firmUser, $this->main);
        $this->seat($this->northUser, $this->north);
        $this->seat($this->southUser, $this->south);
    }

    public function test_a_branch_sees_only_applications_assigned_to_it(): void
    {
        $firmFile = $this->application('firm-file');
        $northFile = $this->application('north-file');
        $southFile = $this->application('south-file');

        $this->assertSees($this->firmUser, [$firmFile, $northFile, $southFile]);
        $this->assertSees($this->spAdmin, [$firmFile, $northFile, $southFile]);
        $this->assertSees($this->admin, [$firmFile, $northFile, $southFile]);
        $this->assertSees($this->northUser, []);
        $this->assertSees($this->southUser, []);

        $assignable = $this->actingAs($this->spAdmin)
            ->getJson('/portal/cip/applications/'.$northFile->uuid.'/assignments')
            ->assertOk()
            ->json('assignable');
        $byId = collect($assignable)->keyBy('id');
        $this->assertSame(CompanyLocation::KIND_MAIN, $byId[$this->firmUser->id]['locationKind']);
        $this->assertSame(CompanyLocation::KIND_BRANCH, $byId[$this->northUser->id]['locationKind']);
        $this->assertSame('North', $byId[$this->northUser->id]['locationName']);

        $this->actingAs($this->spAdmin)
            ->postJson('/portal/cip/applications/'.$northFile->uuid.'/assignments', [
                'userId' => $this->northUser->id,
            ])
            ->assertCreated();

        $northFile->refresh();
        $this->assertSame($this->north->id, $northFile->location_id);

        $this->assertSees($this->northUser, [$northFile]);
        $this->assertSees($this->southUser, []);
        $this->assertSees($this->firmUser, [$firmFile, $southFile]);
        $this->assertSees($this->spAdmin, [$firmFile, $northFile, $southFile]);
        $this->assertSame(
            [$northFile->client_id],
            FolderAccess::clientIdsFor($this->northUser),
        );

        $this->actingAs($this->admin)
            ->postJson('/portal/cip/applications/'.$northFile->uuid.'/assignments', [
                'userId' => $this->firmUser->id,
            ])
            ->assertCreated();

        $northFile->refresh();
        $this->assertSame($this->main->id, $northFile->location_id);
        $this->assertSees($this->northUser, []);
        $this->assertSees($this->firmUser, [$firmFile, $northFile, $southFile]);

        $this->actingAs($this->spAdmin)
            ->deleteJson('/portal/cip/applications/'.$northFile->uuid.'/assignments/'.$this->firmUser->id)
            ->assertOk();

        $northFile->refresh();
        $this->assertSame($this->north->id, $northFile->location_id);
        $this->assertSees($this->northUser, [$northFile]);
        $this->assertSees($this->firmUser, [$firmFile, $southFile]);
    }

    public function test_a_branch_sees_the_application_it_just_filed(): void
    {
        $filed = Applications::create($this->provider, $this->northUser);

        $this->assertNull($filed->location_id);
        $this->assertSees($this->northUser, [$filed]);
        $this->assertSees($this->southUser, []);
        $this->assertSees($this->firmUser, [$filed]);
        $this->assertSees($this->spAdmin, [$filed]);
        $this->assertSees($this->admin, [$filed]);

        $filed->forceFill(['location_id' => $this->south->id])->save();

        $this->assertSees($this->northUser, []);
        $this->assertSees($this->southUser, [$filed]);
        $this->assertSees($this->firmUser, []);
    }

    public function test_a_branch_is_notified_only_for_applications_assigned_to_it(): void
    {
        $firmFile = $this->application('firm-notice');
        $mainFile = $this->application('main-notice');
        $northFile = $this->application('north-notice');
        $southFile = $this->application('south-notice');
        $mainFile->forceFill(['location_id' => $this->main->id])->save();
        $northFile->forceFill(['location_id' => $this->north->id])->save();
        $southFile->forceFill(['location_id' => $this->south->id])->save();

        $this->assertEqualsCanonicalizing(
            ['gil@gcc.example', 'firm@gcc.example'],
            $this->providerEmails($firmFile),
        );
        $this->assertEqualsCanonicalizing(
            ['gil@gcc.example', 'firm@gcc.example'],
            $this->providerEmails($mainFile),
        );
        $this->assertEqualsCanonicalizing(
            ['gil@gcc.example', 'north@gcc.example'],
            $this->providerEmails($northFile),
        );
        $this->assertEqualsCanonicalizing(
            ['gil@gcc.example', 'south@gcc.example'],
            $this->providerEmails($southFile),
        );

        $firmMember = CompanyMember::query()->where('user_id', $this->firmUser->id)->firstOrFail();
        NotificationEmail::choose($this->company, $firmMember, $this->admin);
        $northSide = collect(Contacts::providerSide($northFile->fresh()));
        $this->assertFalse($northSide->contains(fn (array $row) => $row['email'] === 'firm@gcc.example'));
        $this->assertArrayNotHasKey('mail', $northSide->firstWhere('email', 'north@gcc.example'));

        Notices::announce($northFile, Status::NEW, $this->admin);

        Mail::assertQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('north@gcc.example'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('south@gcc.example'));
        Mail::assertNotQueued(Postcard::class, fn (Postcard $mail) => $mail->hasTo('firm@gcc.example'));
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $this->northUser->id,
            'subject_id' => $northFile->id,
            'subject_type' => CipApplication::class,
        ]);
        $this->assertDatabaseMissing('portal_notifications', [
            'user_id' => $this->southUser->id,
            'subject_id' => $northFile->id,
        ]);
        $this->assertDatabaseMissing('portal_notifications', [
            'user_id' => $this->firmUser->id,
            'subject_id' => $northFile->id,
        ]);
    }

    public function test_an_empty_branch_does_not_make_the_applicant_the_provider_side(): void
    {
        $company = Company::create(['uid' => 'empty-branch', 'name' => 'Empty Branch Co', 'email' => 'office@empty.example']);
        $provider = CipProvider::create([
            'name' => 'EMPTY BRANCH CO',
            'code' => 'EBC',
            'company_id' => $company->id,
            'contact_email' => 'notices@empty.example',
        ]);
        $north = CompanyLocations::addBranch($company, 'North', $this->admin);
        $south = CompanyLocations::addBranch($company, 'South', $this->admin);
        $northUser = $this->user(Role::CLIENT, 'only-north@empty.example', 'Only North');
        CompanyMember::create([
            'company_id' => $company->id,
            'location_id' => $north->id,
            'user_id' => $northUser->id,
            'name' => $northUser->name,
            'email' => $northUser->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $application = Applications::create($provider, $this->admin);
        $client = Client::create([
            'uid' => 'empty-applicant',
            'name' => 'Empty Applicant',
            'email' => 'applicant@empty.example',
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $company->id,
            'data' => [],
            'created_by' => $this->admin->id,
        ]);
        $application->forceFill([
            'client_id' => $client->id,
            'location_id' => $south->id,
        ])->save();

        $this->assertSame([], array_column(Contacts::providerSide($application->fresh()), 'email'));

        $application->forceFill(['location_id' => null])->save();
        $this->assertEqualsCanonicalizing(
            ['notices@empty.example', 'office@empty.example'],
            array_column(Contacts::providerSide($application->fresh()), 'email'),
        );
    }

    /** @return list<string> */
    private function providerEmails(CipApplication $application): array
    {
        return array_column(Contacts::providerSide($application->fresh()), 'email');
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function seat(User $user, CompanyLocation $location): void
    {
        CompanyMember::create([
            'company_id' => $this->company->id,
            'location_id' => $location->id,
            'user_id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
    }

    private function application(string $uid): CipApplication
    {
        $application = Applications::create($this->provider, $this->admin);
        $client = Client::create([
            'uid' => $uid,
            'name' => $uid,
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $this->company->id,
            'data' => [],
            'created_by' => $this->admin->id,
        ]);
        $application->forceFill(['client_id' => $client->id])->save();

        return $application->refresh();
    }

    /** @param  list<CipApplication>  $applications */
    private function assertSees(User $user, array $applications): void
    {
        ApplicationScope::forget();
        FolderAccess::forget();
        $this->assertEqualsCanonicalizing(
            array_map(fn (CipApplication $application) => $application->id, $applications),
            ApplicationScope::query($user)->pluck('id')->all(),
        );
    }
}
