<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Security\GeoAccess;
use App\Support\SecurityPolicies;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Geographic restrictions, and the rails that stop them taking the firm down.
 *
 * Most of what is asserted here is what the policy must NOT do: refuse the
 * container's own health check, refuse traffic that never passed the CDN, or
 * let an administrator save a list that locks them out of the screen they
 * would need to undo it.
 */
class GeoAccessTest extends TestCase
{
    use RefreshDatabase;

    /** A public, routable client address — what a real visitor looks like. */
    private const PUBLIC_IP = '69.80.12.89';

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function policy(array $overrides): void
    {
        SecurityPolicies::put('geo', array_merge([
            'mode' => GeoAccess::MODE_OFF,
            'countries' => [],
            'blockUnknown' => false,
            'message' => 'The portal is not available from your location.',
            'blockVpn' => false,
            'vpnMessage' => 'Turn off your VPN or proxy to use the portal.',
        ], $overrides));
    }

    /** A request as the edge would present it: real client IP, country header. */
    private function edge(string $country, string $ip = self::PUBLIC_IP): array
    {
        return ['CF-IPCountry' => $country, 'REMOTE_ADDR' => $ip];
    }

    public function test_off_by_default_lets_every_country_through(): void
    {
        $this->get('/auth/login', $this->edge('CN'))->assertOk();
    }

    public function test_a_blocked_country_is_refused_and_an_allowed_one_is_not(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN', 'RU']]);

        $this->get('/auth/login', $this->edge('CN'))->assertStatus(403);
        $this->get('/auth/login', $this->edge('LC'))->assertOk();
    }

    public function test_an_allow_list_admits_only_the_listed_countries(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_ALLOW, 'countries' => ['LC', 'CA']]);

        $this->get('/auth/login', $this->edge('LC'))->assertOk();
        $this->get('/auth/login', $this->edge('CA'))->assertOk();
        $this->get('/auth/login', $this->edge('CN'))->assertStatus(403);
    }

    public function test_an_empty_allow_list_is_treated_as_unconfigured(): void
    {
        // Enforcing "only these countries" against an empty list would refuse
        // the world, including whoever is trying to populate it.
        $this->policy(['mode' => GeoAccess::MODE_ALLOW, 'countries' => []]);

        $this->get('/auth/login', $this->edge('CN'))->assertOk();
    }

    public function test_block_unknown_refuses_a_public_address_with_no_country(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN'], 'blockUnknown' => true]);

        // Routable client, but the edge reported nothing.
        $this->get('/auth/login', ['REMOTE_ADDR' => self::PUBLIC_IP])->assertStatus(403);
    }

    public function test_block_unknown_does_not_refuse_traffic_that_never_passed_the_edge(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN'], 'blockUnknown' => true]);

        // Local development and anything inside the network: there was no CDN
        // to report a country, so this is not foreign traffic. Refusing it is
        // how "block unknown" would take the whole portal down the first time
        // Cloudflare was bypassed.
        foreach (['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.9'] as $ip) {
            $this->get('/auth/login', ['REMOTE_ADDR' => $ip])->assertOk();
        }
    }

    public function test_the_health_check_is_never_geo_blocked(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_ALLOW, 'countries' => ['LC'], 'blockUnknown' => true]);

        // Refusing /up makes the platform recycle a container that is fine.
        $this->get('/up', $this->edge('CN'))->assertOk();
    }

    public function test_a_refused_json_request_gets_a_code_the_client_can_branch_on(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN']]);

        $this->getJson('/portal/files', $this->edge('CN'))
            ->assertStatus(403)
            ->assertJsonPath('code', 'geo-blocked');
    }

    public function test_the_block_page_does_not_say_which_country_was_seen(): void
    {
        $this->policy([
            'mode' => GeoAccess::MODE_BLOCK,
            'countries' => ['CN'],
            'message' => 'Not available in your region.',
        ]);

        $body = $this->get('/auth/login', $this->edge('CN'))->assertStatus(403)->getContent();

        $this->assertStringContainsString('Not available in your region.', $body);
        $this->assertStringNotContainsString('CN', $body);
    }

    public function test_the_policy_applies_to_public_links_not_only_sign_in(): void
    {
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN']]);

        // A request-file link is a door that never involves an account. The
        // token is alphanumeric (the route constrains it) and need not exist:
        // the point is that the refusal happens before the app ever looks it
        // up, so a blocked country cannot even probe for valid tokens.
        $this->get('/r/aaaabbbbccccdddd', $this->edge('CN'))->assertStatus(403);

        // And the same door is open from an allowed country — 404 here is the
        // token not existing, which is the app working normally.
        $this->get('/r/aaaabbbbccccdddd', $this->edge('LC'))->assertStatus(404);
    }

    public function test_an_admin_cannot_save_an_allow_list_that_excludes_their_own_country(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_ALLOW,
                'countries' => ['CA'],
                'blockUnknown' => false,
                'message' => '',
                'blockVpn' => false,
                'vpnMessage' => '',
            ], $this->edge('LC'))
            ->assertStatus(422);

        $this->assertSame(GeoAccess::MODE_OFF, GeoAccess::policy()['mode']);
    }

    public function test_an_admin_cannot_block_the_country_they_are_signing_in_from(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_BLOCK,
                'countries' => ['LC'],
                'blockUnknown' => false,
                'message' => '',
                'blockVpn' => false,
                'vpnMessage' => '',
            ], $this->edge('LC'))
            ->assertStatus(422);
    }

    public function test_an_admin_can_save_a_workable_policy_and_codes_are_normalised(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_ALLOW,
                // Mixed case, duplicates, and a junk entry the UI should never
                // send but the server must not store.
                'countries' => ['lc', 'LC', 'ca', 'ZZZ'],
                'blockUnknown' => true,
                'message' => '  Contact the firm.  ',
                'blockVpn' => false,
                'vpnMessage' => '',
            ], $this->edge('LC'))
            ->assertStatus(422); // ZZZ is not a two-letter code

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_ALLOW,
                'countries' => ['lc', 'LC', 'ca'],
                'blockUnknown' => true,
                'message' => '  Contact the firm.  ',
                'blockVpn' => false,
                'vpnMessage' => '',
            ], $this->edge('LC'))
            ->assertOk();

        $policy = GeoAccess::policy();
        $this->assertSame(['CA', 'LC'], $policy['countries']);
        $this->assertTrue($policy['blockUnknown']);
        $this->assertSame('Contact the firm.', $policy['message']);
    }

    /**
     * The settings page is its own rail item now, so it needs its own gate.
     *
     * {@see Role::canViewSettingsPage()} returns true for any page it has
     * never heard of, so a new page that nobody registers is a new page
     * everybody can open — including one that turns off access to the portal
     * by country.
     */
    public function test_the_settings_page_is_gated_to_administrators(): void
    {
        $admin = $this->admin();
        $officer = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $client = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::CLIENT,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->assertTrue(Role::canViewSettingsPage($admin, 'geo-access'));
        $this->assertFalse(Role::canViewSettingsPage($officer, 'geo-access'));
        $this->assertFalse(Role::canViewSettingsPage($client, 'geo-access'));

        // Held to the same capability as the rest of the Security rail.
        $this->assertSame(
            Role::canViewSettingsPage($officer, 'security-policy'),
            Role::canViewSettingsPage($officer, 'geo-access'),
        );
    }

    public function test_the_picker_is_offered_with_names_not_bare_codes(): void
    {
        $admin = $this->admin();

        $res = $this->actingAs($admin)
            ->getJson('/admin/security-policies', $this->edge('LC'))
            ->assertOk();

        $options = $res->json('countryOptions');
        $this->assertNotEmpty($options);

        $byCode = collect($options)->keyBy('code');
        $this->assertSame('St. Lucia', $byCode['LC']['name']);
        $this->assertSame('Canada', $byCode['CA']['name']);

        // Sorted by name, so the list reads the way somebody scans it.
        $names = array_column($options, 'name');
        $sorted = $names;
        usort($sorted, 'strcasecmp');
        $this->assertSame($sorted, $names);
    }

    public function test_a_code_that_is_not_a_country_is_dropped(): void
    {
        // The picker cannot send these, but a hand-rolled request can, and a
        // rule naming a country that can never be reported is a rule that
        // sits in the list looking as though it works.
        $this->assertSame(['CA', 'LC'], GeoAccess::normalizeCountries(['LC', 'CA', 'ZZ', 'XX', 'QQ']));
    }

    public function test_only_administrators_may_change_the_policy(): void
    {
        $officer = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::REVIEWING_OFFICER,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($officer)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_BLOCK,
                'countries' => ['LC'],
                'blockUnknown' => false,
                'message' => '',
                'blockVpn' => false,
                'vpnMessage' => '',
            ], $this->edge('CA'))
            ->assertStatus(403);
    }
}
