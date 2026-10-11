<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Engine;
use App\Support\Cip\FolderAccess;
use App\Support\Cip\Phase;
use App\Support\Cip\ProviderTransfer;
use App\Support\Cip\Status;
use App\Support\Cip\Timeline;
use App\Support\Clients\ClientDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Handing a filed CIP application to another service provider must move the
 * client folder with it, or the outgoing firm keeps opening papers that
 * ApplicationScope has already taken away.
 *
 * And the number follows the firm. An application number is the firm's code
 * and that firm's sequence, generated and never typed, so a file that
 * changes firm is numbered again under the new one. It used to keep the old
 * number, which left a file listed under iGraphix wearing GAL26-00001.
 */
class CipProviderTransferTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email = 'someone@example.com'): User
    {
        $user = User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
        ]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ])->save();

        return $user;
    }

    /** The two-digit year numbers are minted with. Never a literal. */
    private function yy(): string
    {
        return now()->format('y');
    }

    /** @return array<string, mixed> */
    private function transfer(User $actor, CipApplication $application, CipProvider $to)
    {
        return $this->actingAs($actor)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $to->uuid,
                'confirm' => true,
            ]);
    }

    /** @return array{0: CipProvider, 1: Company, 2: User, 3: Folder} */
    private function firm(string $code, string $name, User $owner): array
    {
        $company = Company::create([
            'uid' => strtolower($code).'-firm',
            'name' => $name,
        ]);
        $contact = $this->user(Role::CLIENT, strtolower($code).'@firm.test');
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $library = Folder::query()
            ->where('folder_type', Folder::TYPE_ORGANIZATION)
            ->whereRaw('LOWER(name) = ?', ['citizenship applications'])
            ->first();

        if (! $library) {
            $library = Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => 'Citizenship Applications',
                'folder_type' => Folder::TYPE_ORGANIZATION,
                'owner_id' => $owner->id,
                'created_by' => $owner->id,
            ]);
        }

        $firmFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $library->id,
            'folder_type' => Folder::TYPE_USER,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        $provider = CipProvider::create([
            'name' => $name,
            'code' => $code,
            'company_id' => $company->id,
            'folder_id' => $firmFolder->id,
            'active' => true,
        ]);

        return [$provider, $company, $contact, $firmFolder];
    }

    /** @return array{0: CipApplication, 1: Client, 2: Folder} */
    private function filed(User $admin, CipProvider $provider, Folder $firmFolder): array
    {
        $client = Client::create([
            'uid' => 'chen-wei-'.Str::random(4),
            'name' => 'Chen Wei',
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $provider->company_id,
            'company_id' => $provider->company_id,
            'company' => $provider->name,
            'created_by' => $admin->id,
            'data' => [],
        ]);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Chen Wei',
            'parent_id' => $firmFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);
        $client->forceFill(['folder_id' => $folder->id])->save();

        $application = Applications::create($provider, $admin, [
            'client_id' => $client->id,
        ]);
        $application->forceFill(['folder_id' => $folder->id])->save();
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        return [$application->fresh(['provider', 'client']), $client->fresh(), $folder->fresh()];
    }

    public function test_admin_transfer_moves_folder_and_cuts_outgoing_firm_access(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , $galaxyContact, $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, $igaCompany, $igaContact, $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, $client, $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        FolderAccess::forget();
        $this->assertContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
        $this->assertNotContains((int) $client->id, FolderAccess::clientIdsFor($igaContact));

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonPath('application.providerId', $igraphix->uuid)
            ->assertJsonPath('application.provider', 'iGraphix')
            // The number follows the firm, and the answer says what it is
            // now so the screen does not have to ask again.
            ->assertJsonPath('application.internalNumber', 'IGA'.$this->yy().'-00001')
            ->assertJsonPath('application.number', 'IGA'.$this->yy().'-00001')
            ->assertJsonPath('application.clientUid', $client->uid)
            ->assertJsonPath('moved.0.internalNumber', 'IGA'.$this->yy().'-00001')
            ->assertJsonPath('message', 'Transferred to iGraphix; the application number is now IGA'.$this->yy().'-00001.');

        $application->refresh();
        $client->refresh();
        $folder->refresh();

        $this->assertSame($igraphix->id, $application->provider_id);
        $this->assertSame('IGA'.$this->yy().'-00001', $application->internal_number);
        $this->assertDatabaseMissing('cip_applications', ['internal_number' => 'GAL'.$this->yy().'-00001']);
        // The client's address is not the number: links already sent hold.
        $this->assertSame($client->uid, $application->client->uid);
        $this->assertSame($igaCompany->id, $client->referred_by_company_id);
        $this->assertNull(
            $client->company_id,
            'A CIP applicant is referred by the firm, not a Provider contact at it.',
        );
        $this->assertSame($igaFolder->id, $folder->parent_id);
        $this->assertSame($galaxyFolder->id !== $folder->parent_id, true);

        FolderAccess::forget();
        $this->assertNotContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
        $this->assertContains((int) $client->id, FolderAccess::clientIdsFor($igaContact));

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_PROVIDER_TRANSFERRED,
            'actor_id' => $admin->id,
        ]);

        // One row for one act: the move carries both numbers, and the trail
        // says so in a sentence. Nothing is recorded as typed by hand.
        $event = $application->events()->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)->sole();
        $this->assertSame('GAL'.$this->yy().'-00001', $event->meta['previousInternalNumber']);
        $this->assertSame('IGA'.$this->yy().'-00001', $event->meta['internalNumber']);
        $this->assertSame('Galaxy', $event->meta['fromProvider']);
        $this->assertSame('iGraphix', $event->meta['toProvider']);
        $this->assertFalse($application->events()->where('action', CipEvent::ACTION_RENUMBERED)->exists());
        // The number it was born with is still on the row that created it.
        $this->assertSame(
            'GAL'.$this->yy().'-00001',
            $application->events()->where('action', CipEvent::ACTION_CREATED)->sole()->meta['internalNumber'],
        );

        $said = array_column(Timeline::for($application, $admin), 'what');
        $this->assertContains(
            $admin->name.' transferred the application from Galaxy to iGraphix; the application number changed from GAL'
                .$this->yy().'-00001 to IGA'.$this->yy().'-00001',
            $said,
        );
    }

    public function test_transfer_requires_explicit_confirmation(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['confirm']);

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
        // Refused is refused whole: no number spent at the firm it never reached.
        $this->assertSame('GAL'.$this->yy().'-00001', $application->fresh()->internal_number);
        $this->assertSame(0, DB::table('cip_counters')->where('provider_id', $igraphix->id)->count());
    }

    public function test_officer_cannot_transfer_provider(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'cro@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->actingAs($officer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertForbidden();

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
        $this->assertSame('GAL'.$this->yy().'-00001', $application->fresh()->internal_number);
        $this->assertSame(0, DB::table('cip_counters')->where('provider_id', $igraphix->id)->count());
    }

    public function test_add_on_family_moves_together(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$parent, , $parentFolder] = $this->filed($admin, $galaxy, $galaxyFolder);

        $addonClient = Client::create([
            'uid' => 'mei-wei-'.Str::random(4),
            'name' => 'Mei Wei',
            'referral_type' => Client::REFERRAL_COMPANY,
            'referred_by_company_id' => $galaxy->company_id,
            'created_by' => $admin->id,
            'data' => [],
        ]);
        $addonFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Mei Wei',
            'parent_id' => $galaxyFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $addonClient->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);
        $addonClient->forceFill(['folder_id' => $addonFolder->id])->save();

        // Born an Add-On, so it wears an Add-On number (GAL-AO-…) the way a
        // filed one does. Setting the phase afterwards left this fixture a
        // family number on an Add-On row.
        $addon = Applications::create($galaxy, $admin, [
            'client_id' => $addonClient->id,
            'phase' => Phase::ADD_ON,
        ]);
        $this->assertSame('GAL-AO-'.$this->yy().'-00001', $addon->internal_number);
        $addon->forceFill([
            'folder_id' => $addonFolder->id,
            'parent_application_id' => $parent->id,
        ])->save();
        CipPerson::create([
            'application_id' => $addon->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Mei',
            'last_name' => 'Wei',
            'relationship' => 'Spouse',
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$addon->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJsonCount(2, 'moved');

        $this->assertSame($igraphix->id, $parent->fresh()->provider_id);
        $this->assertSame($igraphix->id, $addon->fresh()->provider_id);
        $this->assertSame($igaFolder->id, $parentFolder->fresh()->parent_id);
        $this->assertSame($igaFolder->id, $addonFolder->fresh()->parent_id);

        // Each in its own lane: the family file takes iGraphix's next family
        // number and the Add-On its next Add-On number, and neither spends
        // a slot of the other's sequence.
        $this->assertSame('IGA'.$this->yy().'-00001', $parent->fresh()->internal_number);
        $this->assertSame('IGA-AO-'.$this->yy().'-00001', $addon->fresh()->internal_number);
        $this->assertSame('IGA'.$this->yy().'-00002', Applications::create($igraphix, $admin)->internal_number);
        $this->assertSame(
            'IGA-AO-'.$this->yy().'-00002',
            Applications::create($igraphix, $admin, ['phase' => Phase::ADD_ON])->internal_number,
        );

        // Each row's own audit carries its own pair of numbers.
        $own = $addon->events()->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)->sole()->meta;
        $this->assertSame('GAL-AO-'.$this->yy().'-00001', $own['previousInternalNumber']);
        $this->assertSame('IGA-AO-'.$this->yy().'-00001', $own['internalNumber']);
    }

    public function test_the_new_firms_sequence_carries_on_and_the_old_number_is_not_reissued(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        // iGraphix already has two files of its own.
        Applications::create($igraphix, $admin);
        Applications::create($igraphix, $admin);

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('IGA'.$this->yy().'-00003', $application->fresh()->internal_number);
        $this->assertSame('IGA'.$this->yy().'-00004', Applications::create($igraphix, $admin)->internal_number);
        // Galaxy's next file is its next number. GAL…-00001 is on letters
        // already sent about the file that left, and is nobody else's.
        $this->assertSame('GAL'.$this->yy().'-00002', Applications::create($galaxy, $admin)->internal_number);
    }

    public function test_a_file_moved_back_gets_a_fresh_number_not_its_old_one(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->transfer($admin, $application, $igraphix)->assertOk();
        $this->transfer($admin, $application->fresh(), $galaxy)->assertOk();

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
        $this->assertSame('GAL'.$this->yy().'-00002', $application->fresh()->internal_number);
        $this->assertSame('GAL'.$this->yy().'-00003', Applications::create($galaxy, $admin)->internal_number);
        $this->assertSame('IGA'.$this->yy().'-00002', Applications::create($igraphix, $admin)->internal_number);
    }

    /**
     * The number follows the firm where the reader can see it happen.
     *
     * Picking another firm on the form asks what number that firm would
     * give this application and shows it at once, before Save. It is the
     * same walk the save makes, read-only: nothing is spent by looking, a
     * number somebody already wears is stepped over, and the save then
     * issues exactly what was shown.
     */
    public function test_the_form_is_told_the_number_a_firm_would_give_before_it_is_saved(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , $galaxyContact, $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $yy = $this->yy();

        $ask = fn (User $who, CipProvider $firm) => $this->actingAs($who)->getJson(
            '/portal/cip/applications/number-preview?providerId='.$firm->uuid.'&application='.$application->uuid
        );

        // The firm it is already with: the number it already wears.
        $ask($admin, $galaxy)->assertOk()->assertJsonPath('number', "GAL{$yy}-00001");

        // Another firm: that firm's next number. Asking twice changes nothing.
        $ask($admin, $igraphix)->assertOk()
            ->assertJsonPath('number', "IGA{$yy}-00001")
            ->assertJsonPath('providerId', $igraphix->uuid);
        $ask($admin, $igraphix)->assertOk()->assertJsonPath('number', "IGA{$yy}-00001");
        $this->assertSame(0, DB::table('cip_counters')->where('provider_id', $igraphix->id)->count());
        $this->assertSame("GAL{$yy}-00001", $application->fresh()->internal_number);

        // A number already worn is not offered.
        $squatter = Applications::create($galaxy, $admin);
        $squatter->forceFill(['internal_number' => "IGA{$yy}-00001"])->save();
        $ask($admin, $igraphix)->assertOk()->assertJsonPath('number', "IGA{$yy}-00002");

        // And the save issues what was shown.
        $this->transfer($admin, $application, $igraphix)
            ->assertOk()
            ->assertJsonPath('application.internalNumber', "IGA{$yy}-00002");

        // Only for a firm the reader may file under.
        $ask($galaxyContact, $igraphix)->assertNotFound();
        // And only for an application within their reach: it left Galaxy.
        $ask($galaxyContact, $galaxy)->assertNotFound();
    }

    public function test_a_new_form_is_told_the_first_number_in_its_own_lane(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy] = $this->firm('GAL', 'Galaxy', $admin);
        Applications::create($galaxy, $admin);
        $yy = $this->yy();

        $this->actingAs($admin)
            ->getJson('/portal/cip/applications/number-preview?providerId='.$galaxy->uuid)
            ->assertOk()->assertJsonPath('number', "GAL{$yy}-00002");
        $this->actingAs($admin)
            ->getJson('/portal/cip/applications/number-preview?providerId='.$galaxy->uuid.'&phase='.Phase::ADD_ON)
            ->assertOk()->assertJsonPath('number', "GAL-AO-{$yy}-00001");
    }

    /**
     * The Unit's number is not the firm's. Every screen already shows the
     * CIP number once there is one, and a change of firm does not touch it;
     * only the firm's own reference underneath is issued again.
     */
    public function test_a_file_the_unit_has_numbered_keeps_its_cip_number(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $application->forceFill(['cip_number' => '10T1G12661P'])->save();

        $this->transfer($admin, $application, $igraphix)
            ->assertOk()
            ->assertJsonPath('application.number', '10T1G12661P')
            ->assertJsonPath('application.internalNumber', 'IGA'.$this->yy().'-00001');

        $this->assertSame('10T1G12661P', $application->fresh()->cip_number);
        $this->assertSame('10T1G12661P', $application->fresh()->displayNumber());
    }

    /**
     * The counter is not the only author of numbers. One typed by hand, kept
     * from an earlier move, or left by a merged register row can sit ahead
     * of it, and a mint that trusted the counter died on the unique index:
     * the transfer answered 500, and so did every filing under that firm.
     */
    public function test_a_number_somebody_already_wears_is_stepped_over(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        // Another Galaxy file wearing what would be iGraphix's first number,
        // and a binned one wearing its second.
        $squatter = Applications::create($galaxy, $admin);
        $squatter->forceFill(['internal_number' => 'IGA'.$this->yy().'-00001'])->save();
        $binned = Applications::create($galaxy, $admin);
        $binned->forceFill(['internal_number' => 'IGA'.$this->yy().'-00002'])->save();
        $binned->delete();

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('IGA'.$this->yy().'-00003', $application->fresh()->internal_number);
        // And the firm is not left wedged: its next native filing mints.
        $this->assertSame('IGA'.$this->yy().'-00004', Applications::create($igraphix, $admin)->internal_number);
    }

    /**
     * A file that already wears the firm's own shape keeps it. That is a
     * file coming home with the number it never lost: the ones moved before
     * numbers followed the firm are exactly that when they go back.
     */
    public function test_a_number_already_in_the_new_firms_shape_is_kept_and_the_counter_moves_past_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $application->forceFill(['internal_number' => 'IGA'.$this->yy().'-00005'])->save();

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('IGA'.$this->yy().'-00005', $application->fresh()->internal_number);
        $this->assertSame('IGA'.$this->yy().'-00006', Applications::create($igraphix, $admin)->internal_number);
        // Nothing changed, so the trail does not claim a number did.
        $meta = $application->events()->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)->sole()->meta;
        $this->assertArrayNotHasKey('previousInternalNumber', $meta);
    }

    /**
     * YY is the year the application was opened. A move changes the firm's
     * code and the sequence; it does not make an old file look new.
     */
    public function test_a_moved_file_keeps_the_year_it_was_opened_in(): void
    {
        $this->travelTo('2026-11-20 10:00:00');
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $this->assertSame('GAL26-00001', $application->internal_number);

        $this->travelTo('2027-02-03 10:00:00');
        // iGraphix has opened a file of its own this year.
        $this->assertSame('IGA27-00001', Applications::create($igraphix, $admin)->internal_number);

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('IGA26-00001', $application->fresh()->internal_number);
        $this->assertSame('IGA27-00002', Applications::create($igraphix, $admin)->internal_number);
    }

    /**
     * Every letter, invoice and email sent before the move calls the file
     * by its old number. Typing that number still finds it.
     */
    public function test_the_file_is_still_found_by_the_number_it_used_to_wear(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $other = Applications::create($galaxy, $admin);

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $old = 'GAL'.$this->yy().'-00001';
        $new = 'IGA'.$this->yy().'-00001';

        foreach ([$old, strtolower($old), $new] as $term) {
            $ids = collect($this->actingAs($admin)
                ->getJson('/portal/cip/applications?q='.urlencode($term))
                ->assertOk()
                ->json('applications'))->pluck('id')->all();

            $this->assertSame([$application->uuid], $ids, 'searching '.$term);
        }

        // The file that still wears a Galaxy number is found by its own, and
        // the hub's client search honours the old number too.
        $this->assertSame(
            [$other->uuid],
            collect($this->actingAs($admin)
                ->getJson('/portal/cip/applications?q='.urlencode('GAL'.$this->yy().'-00002'))
                ->json('applications'))->pluck('id')->all(),
        );

        $found = Client::query()->where(function ($q) use ($old) {
            $q->whereRaw('1 = 0');
            ClientDirectory::matchApplicationNumber($q, $old);
        })->pluck('id')->all();
        $this->assertSame([$application->fresh()->client_id], $found);
    }

    /**
     * A file with no applicant named yet has a hub client, and a folder,
     * called after its number. Both follow the number; the client's address
     * does not, because links already sent point at it.
     */
    public function test_a_client_still_named_after_the_file_follows_its_number(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, $client, $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        $standIn = 'Application GAL'.$this->yy().'-00001';
        $client->forceFill(['name' => $standIn])->save();
        $folder->forceFill(['name' => $standIn])->save();
        $uid = $client->uid;

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('Application IGA'.$this->yy().'-00001', $client->fresh()->name);
        $this->assertSame('Application IGA'.$this->yy().'-00001', $folder->fresh()->name);
        $this->assertSame($igaFolder->id, $folder->fresh()->parent_id);
        $this->assertSame($uid, $client->fresh()->uid);
    }

    public function test_a_client_somebody_named_is_not_renamed_by_the_move(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, $client] = $this->filed($admin, $galaxy, $galaxyFolder);

        $this->transfer($admin, $application, $igraphix)->assertOk();

        $this->assertSame('Chen Wei', $client->fresh()->name);
    }

    /**
     * A firm with no company behind it still takes the file away from the
     * firm that had it.
     *
     * Private Clients has no company by design, and neither does a firm
     * born from a library folder. The hub referral used to be rewritten
     * only when the destination had a company to name, and folder reach is
     * read from that referral, so the firm that lost the file went on
     * opening the client's papers as an editor while the dialog said it
     * "loses access".
     */
    public function test_a_move_to_a_firm_with_no_company_cuts_the_outgoing_firm_off(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, $galaxyCompany, $galaxyContact, $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        $private = CipProvider::create(['name' => 'Private Clients', 'code' => 'PRI', 'active' => true]);
        [$application, $client] = $this->filed($admin, $galaxy, $galaxyFolder);

        FolderAccess::forget();
        $this->assertContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
        $this->assertSame($galaxyCompany->id, $client->referred_by_company_id);

        $this->transfer($admin, $application, $private)
            ->assertOk()
            ->assertJsonPath('application.internalNumber', 'PRI'.$this->yy().'-00001');

        $client->refresh();
        $this->assertSame(Client::REFERRAL_PRIVATE, $client->referral_type);
        $this->assertNull($client->referred_by_company_id);

        FolderAccess::forget();
        $this->assertNotContains((int) $client->id, FolderAccess::clientIdsFor($galaxyContact));
    }

    /**
     * One move, however many times it is asked for.
     *
     * A double click, or the dialog racing the edit form: the second
     * request arrives holding a copy of the row from before the first one
     * landed. It must find the application already there and do nothing,
     * not mint a second number and write a second audit row.
     */
    public function test_moving_twice_with_a_stale_copy_moves_once(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);
        $stale = $application->fresh();

        $this->assertNotNull(ProviderTransfer::rehome($application, $igraphix, $admin));
        $this->assertNull(ProviderTransfer::rehome($stale, $igraphix, $admin));

        $this->assertSame('IGA'.$this->yy().'-00001', $application->fresh()->internal_number);
        $this->assertSame(1, $application->events()->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)->count());
        $this->assertSame(1, (int) DB::table('cip_counters')->where('provider_id', $igraphix->id)->value('last_sequence'));
    }

    /** A condition handed to the move is judged on the row as it stands, not on the caller's copy. */
    public function test_a_move_conditional_on_the_row_is_refused_when_the_row_has_moved_on(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$application] = $this->filed($admin, $galaxy, $galaxyFolder);

        $moved = ProviderTransfer::rehome(
            $application, $igraphix, $admin, [],
            fn (CipApplication $locked) => $locked->status === Status::DRAFT,
        );

        $this->assertNull($moved, 'a filed application is not a draft, whatever the caller believed');
        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
        $this->assertSame(0, DB::table('cip_counters')->where('provider_id', $igraphix->id)->count());
    }

    /**
     * A move the library refuses is refused whole.
     *
     * The firm, the number and the counter are written before the folder is
     * moved, in the same transaction, so a folder that cannot go (here, a
     * destination that sits inside the folder being moved) takes all three
     * back with it. No number is spent at a firm the file never reached.
     */
    public function test_a_refused_folder_move_takes_the_firm_and_the_number_back_with_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, $galaxyCompany, , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, $client, $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        // iGraphix's drawer is inside the client's own folder: moving the
        // client folder there would put it inside itself.
        $igaFolder->forceFill(['parent_id' => $folder->id])->save();

        $this->transfer($admin, $application, $igraphix)->assertStatus(422);

        $this->assertSame($galaxy->id, $application->fresh()->provider_id);
        $this->assertSame('GAL'.$this->yy().'-00001', $application->fresh()->internal_number);
        $this->assertSame($galaxyCompany->id, $client->fresh()->referred_by_company_id);
        $this->assertSame($galaxyFolder->id, $folder->fresh()->parent_id);
        $this->assertSame(0, DB::table('cip_counters')->where('provider_id', $igraphix->id)->count());
        $this->assertFalse($application->events()->where('action', CipEvent::ACTION_PROVIDER_TRANSFERRED)->exists());
    }

    /**
     * The number the form showed an Add-On is the number it gets.
     *
     * A family moves together and each lane mints in the order the rows are
     * walked. Walked parent-first, the second of two Add-Ons was shown the
     * lane's next number and then watched its elder sibling take it. The
     * application the reader is moving goes first.
     */
    public function test_a_second_add_on_gets_the_number_the_form_showed_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$parent] = $this->filed($admin, $galaxy, $galaxyFolder);
        $yy = $this->yy();

        $addOns = collect([1, 2])->map(function () use ($galaxy, $admin, $parent) {
            $addOn = Applications::create($galaxy, $admin, ['phase' => Phase::ADD_ON]);
            $addOn->forceFill(['parent_application_id' => $parent->id])->save();

            return $addOn->fresh();
        });
        [$elder, $second] = $addOns->all();

        $shown = $this->actingAs($admin)->getJson(
            '/portal/cip/applications/number-preview?providerId='.$igraphix->uuid.'&application='.$second->uuid
        )->assertOk()->json('number');
        $this->assertSame("IGA-AO-{$yy}-00001", $shown);

        $this->transfer($admin, $second, $igraphix)->assertOk()->assertJsonCount(3, 'moved');

        $this->assertSame($shown, $second->fresh()->internal_number);
        $this->assertSame("IGA-AO-{$yy}-00002", $elder->fresh()->internal_number);
        $this->assertSame("IGA{$yy}-00001", $parent->fresh()->internal_number);
    }

    /**
     * The files moved before numbers followed the firm: listed, then
     * numbered again, once, by the repair. A file that a register merge
     * moved has no transfer in its trail and is left exactly as it is.
     */
    public function test_the_repair_numbers_again_what_was_moved_under_the_old_rule(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix] = $this->firm('IGA', 'iGraphix', $admin);
        [$moved] = $this->filed($admin, $galaxy, $galaxyFolder);

        // What a transfer used to leave: the firm changed, the number did
        // not, and the trail says who moved it.
        $moved->forceFill(['provider_id' => $igraphix->id])->save();
        Engine::record($moved, CipEvent::ACTION_PROVIDER_TRANSFERRED, $admin, [
            'fromProvider' => 'Galaxy', 'toProvider' => 'iGraphix',
        ]);

        // A merge's leftover: under iGraphix with a Galaxy number, nobody
        // having transferred it.
        $merged = Applications::create($galaxy, $admin);
        $merged->forceFill(['provider_id' => $igraphix->id])->save();
        $mergedNumber = $merged->internal_number;

        // What the old parent link left: an Add-On opened under Galaxy,
        // then linked to a main application at iGraphix. The firm was
        // written, with no audit row and no new number.
        $main = Applications::create($igraphix, $admin);
        $followed = Applications::create($galaxy, $admin, ['phase' => Phase::ADD_ON]);
        $followed->forceFill(['provider_id' => $igraphix->id, 'parent_application_id' => $main->id])->save();
        $this->assertSame('GAL-AO-'.$this->yy().'-00001', $followed->internal_number);

        // And a merged family's Add-On, which wears a code no longer on the
        // register and keeps it.
        $retired = CipProvider::create(['name' => 'Old Row', 'code' => 'OLD', 'active' => true]);
        $mergedParent = Applications::create($retired, $admin);
        $mergedAddOn = Applications::create($retired, $admin, ['phase' => Phase::ADD_ON]);
        $mergedParent->forceFill(['provider_id' => $igraphix->id])->save();
        $mergedAddOn->forceFill(['provider_id' => $igraphix->id, 'parent_application_id' => $mergedParent->id])->save();
        $retired->delete();

        $this->artisan('cip:remint-transferred')
            ->expectsOutputToContain('2 application(s) would be numbered again')
            ->assertSuccessful();
        $this->assertSame('GAL'.$this->yy().'-00001', $moved->fresh()->internal_number);

        $this->artisan('cip:remint-transferred', ['--apply' => true])
            ->expectsOutputToContain('2 application(s) numbered again')
            ->assertSuccessful();

        // iGraphix had minted one family number of its own (the Add-On's
        // main application), so the moved file takes the next.
        $this->assertSame('IGA'.$this->yy().'-00002', $moved->fresh()->internal_number);
        $this->assertSame('IGA-AO-'.$this->yy().'-00001', $followed->fresh()->internal_number);
        $this->assertSame($mergedNumber, $merged->fresh()->internal_number);
        $this->assertSame('OLD-AO-'.$this->yy().'-00001', $mergedAddOn->fresh()->internal_number);

        $event = $moved->events()->where('action', CipEvent::ACTION_RENUMBERED)->sole();
        $this->assertNull($event->actor_id);
        $this->assertSame('GAL'.$this->yy().'-00001', $event->meta['previousInternalNumber']);
        $this->assertContains(
            'the system changed the application number from GAL'.$this->yy().'-00001 to IGA'.$this->yy().'-00002',
            array_map('lcfirst', array_column(Timeline::for($moved->fresh(), $admin), 'what')),
        );

        // Once is enough.
        $this->artisan('cip:remint-transferred', ['--apply' => true])
            ->expectsOutputToContain('already wears')
            ->assertSuccessful();
    }

    public function test_name_collision_under_destination_is_renamed_not_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'admin@example.com');
        [$galaxy, , , $galaxyFolder] = $this->firm('GAL', 'Galaxy', $admin);
        [$igraphix, , , $igaFolder] = $this->firm('IGA', 'iGraphix', $admin);
        [$application, , $folder] = $this->filed($admin, $galaxy, $galaxyFolder);

        Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Chen Wei',
            'parent_id' => $igaFolder->id,
            'folder_type' => Folder::TYPE_CLIENT,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/provider', [
                'providerId' => $igraphix->uuid,
                'confirm' => true,
            ])
            ->assertOk();

        $folder->refresh();
        $this->assertSame($igaFolder->id, $folder->parent_id);
        $this->assertNotSame('Chen Wei', $folder->name);
        $this->assertStringStartsWith('Chen Wei', $folder->name);
    }
}
