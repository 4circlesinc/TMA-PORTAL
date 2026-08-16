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
use App\Support\Cip\Applications;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The catch-up read behind offline applications.
 *
 * A device that has been away asks what has moved since it last looked. The
 * interesting cases are all about not lying by omission: the cursor must not
 * drop a row at a page boundary, it must not hand an account rows it may not
 * see, and a change to a person — not to the application row itself — has to
 * be a change the cursor notices, because that is what most edits are.
 */
class CipApplicationSyncTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
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

    private function sync(User $as, array $query = [])
    {
        return $this->actingAs($as)->getJson(
            '/portal/cip/applications/sync'.($query ? '?'.http_build_query($query) : ''),
        );
    }

    public function test_no_cursor_returns_everything_the_account_may_see(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        Applications::create($provider, $admin);
        Applications::create($provider, $admin);

        $res = $this->sync($admin);

        $res->assertOk();
        $this->assertCount(2, $res->json('applications'));
        $this->assertFalse($res->json('more'));
        $this->assertNotNull($res->json('cursor.since'));
    }

    public function test_the_cursor_returns_only_what_moved_after_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $old = Applications::create($provider, $admin);
        $old->forceFill(['updated_at' => now()->subDay()])->saveQuietly();

        $recent = Applications::create($provider, $admin);
        $recent->forceFill(['updated_at' => now()])->saveQuietly();

        $res = $this->sync($admin, ['since' => now()->subHours(2)->toIso8601String()]);

        $res->assertOk();
        $this->assertSame(
            [$recent->uuid],
            array_column($res->json('applications'), 'id'),
        );
    }

    /**
     * Two applications sharing a timestamp, read one at a time.
     *
     * This is the case the id half of the cursor exists for. On `updated_at`
     * alone the second page asks for "later than 12:00:00" and never sees the
     * other row saved in that second — a record that is quietly wrong on a
     * laptop for ever, which is precisely the failure the SharePoint sync
     * taught us to design against.
     */
    public function test_a_page_boundary_inside_one_second_drops_nothing(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $stamp = now()->startOfSecond();
        $first = Applications::create($provider, $admin);
        $second = Applications::create($provider, $admin);
        $first->forceFill(['updated_at' => $stamp])->saveQuietly();
        $second->forceFill(['updated_at' => $stamp])->saveQuietly();

        // What the client stores after a page that ended on the first of them.
        $res = $this->sync($admin, [
            'since' => $stamp->toIso8601String(),
            'after' => $first->id,
        ]);

        $res->assertOk();
        // The boundary row is re-delivered (inclusive tie-break, so a second
        // change inside the same instant can never be skipped); the assertion
        // that matters is that `second` is not lost.
        $this->assertSame(
            [$first->uuid, $second->uuid],
            array_column($res->json('applications'), 'id'),
        );
    }

    public function test_editing_a_person_moves_the_application_the_cursor_reads(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider();

        $application = Applications::create($provider, $admin);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Habtoor',
        ]);

        // Wind the application back, so only the person's own save can bring
        // it into the window below.
        $application->forceFill(['updated_at' => now()->subDay()])->saveQuietly();

        $cursor = now()->subHours(2)->toIso8601String();
        $this->assertCount(0, $this->sync($admin, ['since' => $cursor])->json('applications'));

        $person->forceFill(['first_name' => 'Aseem'])->save();

        $this->assertSame(
            [$application->uuid],
            array_column($this->sync($admin, ['since' => $cursor])->json('applications'), 'id'),
        );
    }

    public function test_it_answers_within_the_readers_own_slice(): void
    {
        $staff = $this->user(Role::EMPLOYEE);

        $company = Company::create(['uid' => 'gal-firm', 'name' => 'GAL Firm']);
        $contact = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $theirs = Applications::create($this->provider('GAL', $company), $staff);
        Applications::create($this->provider('BLU'), $staff);

        $res = $this->sync($contact);

        $res->assertOk();
        $this->assertSame([$theirs->uuid], array_column($res->json('applications'), 'id'));
    }

    public function test_an_account_with_no_reach_is_told_nothing_exists(): void
    {
        // An account the firm holds no client record for and that belongs to
        // no provider firm has no reach into the module, and the module
        // answers 404 rather than 403 throughout — existence must not leak,
        // and a catch-up read is no place to start.
        $this->sync($this->user(Role::CLIENT))->assertNotFound();
    }

    public function test_a_nonsense_cursor_is_treated_as_no_cursor(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        Applications::create($this->provider(), $admin);

        $res = $this->sync($admin, ['since' => 'last thursday-ish']);

        $res->assertOk();
        $this->assertCount(1, $res->json('applications'));
    }

    public function test_the_record_says_which_client_it_belongs_to(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = Client::create([
            'uid' => 'asem-habtoor',
            'name' => 'Asem Habtoor',
            'created_by' => $admin->id,
            'data' => [],
        ]);

        Applications::create($this->provider(), $admin, ['client_id' => $client->id]);

        // The offline cache files an application under the client whose
        // profile will ask for it, so the record has to carry the uid.
        $this->assertSame(
            'asem-habtoor',
            $this->sync($admin)->json('applications.0.clientUid'),
        );
    }
}
