<?php

namespace Tests\Feature;

use App\Support\Privacy\PrivacyPolicy;
use Tests\TestCase;

class PrivacyPolicyCookiesTest extends TestCase
{
    public function test_the_privacy_policy_lists_necessary_cookies(): void
    {
        $this->assertSame('2026-09-25', PrivacyPolicy::VERSION);

        $response = $this->get('/privacy-policy');

        $response->assertOk();
        $response->assertSee('tma-portal-session', false);
        $response->assertSee('XSRF-TOKEN', false);
        $response->assertSee('tma_device_trust', false);
        $response->assertSee('tma_trusted_device', false);
        $response->assertSee('__cf_bm', false);
        $response->assertSee('strictly necessary', false);
        $response->assertSee('Last updated: September 25, 2026', false);
    }
}
