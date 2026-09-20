<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Security\Anonymiser;
use App\Support\Security\GeoAccess;
use App\Support\SecurityPolicies;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Refusing VPNs, proxies and Tor.
 *
 * The firm asked for this with no exception list, so the tests that matter
 * most are the ones about what must NOT be refused: an ordinary residential
 * visitor, local traffic, the health check, and — above all — everybody, on
 * the day the reputation API is slow or down.
 */
class AnonymiserBlockTest extends TestCase
{
    use RefreshDatabase;

    /** A residential address: a client at home. */
    private const HOME_IP = '69.80.12.89';

    /** Inside DigitalOcean — where a commercial VPN exits. */
    private const VPN_IP = '159.65.44.10';

    private function policy(array $overrides = []): void
    {
        SecurityPolicies::put('geo', array_merge([
            'mode' => GeoAccess::MODE_OFF,
            'countries' => [],
            'blockUnknown' => false,
            'message' => 'The portal is not available from your location.',
            'blockVpn' => true,
            'vpnMessage' => 'Turn off your VPN or proxy to use the portal.',
        ], $overrides));
    }

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

    public function test_off_by_default_so_a_vpn_is_not_refused_until_asked(): void
    {
        SecurityPolicies::put('geo', ['mode' => GeoAccess::MODE_OFF, 'blockVpn' => false]);

        $this->get('/auth/login', ['REMOTE_ADDR' => self::VPN_IP, 'CF-IPCountry' => 'LC'])->assertOk();
    }

    public function test_a_hosting_range_is_refused_and_a_home_connection_is_not(): void
    {
        $this->policy();

        $this->get('/auth/login', ['REMOTE_ADDR' => self::VPN_IP, 'CF-IPCountry' => 'LC'])
            ->assertRedirect(route('geo.blocked'));

        $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])
            ->assertOk();
    }

    public function test_tor_is_refused(): void
    {
        $this->policy();

        // Cloudflare labels Tor exits with the pseudo-country T1.
        $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'T1'])
            ->assertRedirect(route('geo.blocked'));
    }

    public function test_a_waf_rule_can_state_the_verdict_directly(): void
    {
        $this->policy();

        // CF-Anonymiser is ours: a WAF custom rule sets it on whatever
        // expression the firm's plan supports. It is a statement, not an
        // inference, so it is believed.
        $this->get('/auth/login', [
            'REMOTE_ADDR' => self::HOME_IP,
            'CF-IPCountry' => 'LC',
            'CF-Anonymiser' => 'vpn',
        ])->assertRedirect(route('geo.blocked'));

        $this->get('/auth/login', [
            'REMOTE_ADDR' => self::HOME_IP,
            'CF-IPCountry' => 'LC',
            'CF-Anonymiser' => 'no',
        ])->assertOk();
    }

    public function test_a_bot_score_is_read_from_the_managed_transform(): void
    {
        $this->policy();

        // 1 = certainly automated, 99 = certainly human.
        $this->get('/auth/login', [
            'REMOTE_ADDR' => self::HOME_IP,
            'CF-IPCountry' => 'LC',
            'CF-Bot-Score' => '1',
        ])->assertRedirect(route('geo.blocked'));

        // A person on a VPN is not a bot, and a middling score must not be
        // read as one — that would refuse ordinary clients by the dozen.
        foreach (['30', '50', '99'] as $human) {
            $this->get('/auth/login', [
                'REMOTE_ADDR' => self::HOME_IP,
                'CF-IPCountry' => 'LC',
                'CF-Bot-Score' => $human,
            ])->assertOk();
        }
    }

    public function test_the_legacy_threat_score_still_works_where_it_is_configured(): void
    {
        $this->policy();

        // Cloudflare is retiring this field, but an edge already set up for
        // it should not quietly stop enforcing.
        $this->get('/auth/login', [
            'REMOTE_ADDR' => self::HOME_IP,
            'CF-IPCountry' => 'LC',
            'CF-Threat-Score' => '45',
        ])->assertRedirect(route('geo.blocked'));

        $this->get('/auth/login', [
            'REMOTE_ADDR' => self::HOME_IP,
            'CF-IPCountry' => 'LC',
            'CF-Threat-Score' => '0',
        ])->assertOk();
    }

    public function test_local_and_private_traffic_is_never_treated_as_a_vpn(): void
    {
        $this->policy();

        // No edge in front of these, and no visitor behind them. Refusing
        // them would break local development and internal health traffic.
        foreach (['127.0.0.1', '10.0.0.5', '192.168.1.20'] as $ip) {
            $this->get('/auth/login', ['REMOTE_ADDR' => $ip])->assertOk();
        }
    }

    public function test_the_health_check_is_never_refused(): void
    {
        $this->policy();

        $this->get('/up', ['REMOTE_ADDR' => self::VPN_IP])->assertOk();
    }

    public function test_the_refusal_tells_the_visitor_what_to_do(): void
    {
        $this->policy(['vpnMessage' => 'Please disconnect your VPN.']);

        $this->get('/auth/login', ['REMOTE_ADDR' => self::VPN_IP])
            ->assertRedirect(route('geo.blocked'));

        // Unlike a country block, this one has a remedy, so the page says it.
        $this->get(route('geo.blocked'), ['REMOTE_ADDR' => self::VPN_IP])
            ->assertStatus(403)
            ->assertSee('Please disconnect your VPN.', false);
    }

    public function test_a_json_client_gets_a_distinct_code(): void
    {
        $this->policy();

        $this->getJson('/portal/files', ['REMOTE_ADDR' => self::VPN_IP])
            ->assertStatus(403)
            ->assertJsonPath('code', 'vpn-blocked');
    }

    /**
     * The one that would hurt most in production.
     *
     * If the reputation provider is slow, broken, or rate-limiting, the
     * portal must carry on using the free signals. "We could not check" is
     * not "this is a VPN", and a paid API must never be able to take sign-in
     * down with it.
     */
    public function test_a_failing_reputation_provider_does_not_refuse_anybody(): void
    {
        config([
            'services.ip_reputation.driver' => 'ipqualityscore',
            'services.ip_reputation.key' => 'test-key',
        ]);
        $this->policy();

        foreach ([
            Http::response('', 500),
            Http::response(['success' => false], 200),
            Http::response('not json at all', 200),
        ] as $failure) {
            Cache::flush();
            Http::fake(['ipqualityscore.com/*' => $failure]);

            $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])
                ->assertOk();
        }
    }

    public function test_the_reputation_provider_is_believed_when_it_answers(): void
    {
        config([
            'services.ip_reputation.driver' => 'ipqualityscore',
            'services.ip_reputation.key' => 'test-key',
        ]);
        $this->policy();

        Http::fake([
            'ipqualityscore.com/*' => Http::response([
                'success' => true,
                'vpn' => true,
                'proxy' => false,
                'tor' => false,
            ]),
        ]);

        // A residential address the free signals would have let through.
        $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])
            ->assertRedirect(route('geo.blocked'));
    }

    public function test_a_verdict_is_cached_so_one_address_is_not_looked_up_twice(): void
    {
        config([
            'services.ip_reputation.driver' => 'ipqualityscore',
            'services.ip_reputation.key' => 'test-key',
        ]);
        $this->policy();

        Http::fake([
            'ipqualityscore.com/*' => Http::response(['success' => true, 'vpn' => true]),
        ]);

        foreach (range(1, 3) as $ignored) {
            $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])
                ->assertRedirect(route('geo.blocked'));
        }

        // Three refusals, one paid lookup.
        Http::assertSentCount(1);
    }

    public function test_no_lookup_happens_when_no_provider_is_configured(): void
    {
        config(['services.ip_reputation.driver' => '', 'services.ip_reputation.key' => '']);
        $this->policy();

        Http::fake();

        $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])->assertOk();

        Http::assertNothingSent();
    }

    public function test_a_country_refusal_short_circuits_before_any_paid_lookup(): void
    {
        config([
            'services.ip_reputation.driver' => 'ipqualityscore',
            'services.ip_reputation.key' => 'test-key',
        ]);
        $this->policy(['mode' => GeoAccess::MODE_BLOCK, 'countries' => ['CN']]);

        Http::fake();

        $this->get('/auth/login', ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'CN'])
            ->assertRedirect(route('geo.blocked'));

        // Already refused for where they are; do not also pay to ask about it.
        Http::assertNothingSent();
    }

    public function test_an_admin_on_a_vpn_cannot_turn_the_setting_on(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_OFF,
                'countries' => [],
                'blockUnknown' => false,
                'message' => '',
                'blockVpn' => true,
                'vpnMessage' => '',
            ], ['REMOTE_ADDR' => self::VPN_IP, 'CF-IPCountry' => 'LC'])
            ->assertStatus(422);

        $this->assertFalse(GeoAccess::policy()['blockVpn']);
    }

    public function test_an_admin_on_a_home_connection_can_turn_it_on(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/security-policies/geo', [
                'mode' => GeoAccess::MODE_OFF,
                'countries' => [],
                'blockUnknown' => false,
                'message' => '',
                'blockVpn' => true,
                'vpnMessage' => '  Disconnect your VPN.  ',
            ], ['REMOTE_ADDR' => self::HOME_IP, 'CF-IPCountry' => 'LC'])
            ->assertOk();

        $policy = GeoAccess::policy();
        $this->assertTrue($policy['blockVpn']);
        $this->assertSame('Disconnect your VPN.', $policy['vpnMessage']);
    }

    /**
     * The clouds a browser-extension VPN actually exits from.
     *
     * The first list covered the VPN-specialist networks (M247, Vultr,
     * DigitalOcean…) and missed AWS, Google Cloud and Azure, which is where
     * the free tier of most Chrome extensions runs. A Chrome VPN walked
     * through the portal because of it.
     */
    public function test_the_big_cloud_platforms_are_treated_as_hosting(): void
    {
        foreach ([
            '52.95.110.1',     // AWS
            '3.5.140.1',       // AWS
            '34.102.136.180',  // Google Cloud
            '35.190.1.1',      // Google Cloud
            '20.190.128.1',    // Azure
            '40.77.167.51',    // Azure
            '129.146.1.1',     // Oracle Cloud
            '51.15.1.1',       // Scaleway
            '161.97.1.1',      // Contabo
        ] as $ip) {
            $this->assertTrue(Anonymiser::inHostingRange($ip), $ip.' should read as hosting');
        }
    }

    /**
     * Cloudflare's own ranges are NOT hosting, and must never be.
     *
     * The portal sits behind Cloudflare. If its edge addresses read as an
     * anonymiser, then the first request to arrive after the toggle went on
     * would refuse itself and take the whole portal down.
     */
    public function test_cloudflares_own_ranges_are_never_refused(): void
    {
        foreach (['104.16.0.1', '172.64.0.1', '198.41.128.1', '162.158.0.1'] as $ip) {
            $this->assertFalse(Anonymiser::inHostingRange($ip), $ip.' is Cloudflare and must stay allowed');
        }
    }

    public function test_known_hosting_ranges_are_recognised_and_homes_are_not(): void
    {
        foreach (['159.65.44.10', '45.32.1.1', '104.131.9.9', '5.9.100.1', '51.75.2.2'] as $ip) {
            $this->assertTrue(Anonymiser::inHostingRange($ip), $ip.' should read as hosting');
        }

        foreach ([self::HOME_IP, '209.59.91.136', '83.110.104.239', '8.8.8.8'] as $ip) {
            $this->assertFalse(Anonymiser::inHostingRange($ip), $ip.' should not read as hosting');
        }
    }
}
