<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The office and remote maps in Status settings are drawn by Leaflet.
 *
 * The portal's Content-Security-Policy allows scripts and stylesheets from
 * 'self' only, so the library has to ship inside public/ — a copy fetched
 * from a CDN is refused by every browser, the Mac and Windows apps and the
 * Android app alike, and the dialog shows "Map unavailable" instead.
 */
class PresenceMapAssetsTest extends TestCase
{
    public function test_leaflet_ships_inside_the_portal(): void
    {
        foreach ([
            'leaflet.js',
            'leaflet.css',
            'images/marker-icon.png',
            'images/marker-icon-2x.png',
            'images/marker-shadow.png',
        ] as $file) {
            $this->assertFileExists(public_path('js/vendor/leaflet/'.$file));
        }
    }

    public function test_presence_script_loads_the_map_library_from_the_portal(): void
    {
        $script = file_get_contents(public_path('js/presence-status.js'));

        $this->assertStringContainsString("'js/vendor/leaflet/'", $script);
        $this->assertStringNotContainsString('unpkg.com', $script);
        $this->assertStringNotContainsString('cdnjs.cloudflare.com', $script);
        $this->assertStringNotContainsString('cdn.jsdelivr.net', $script);
    }

    public function test_the_policy_still_refuses_scripts_from_a_cdn(): void
    {
        $csp = $this->get('/auth/login')->headers->get('Content-Security-Policy');

        $this->assertNotNull($csp);
        $this->assertMatchesRegularExpression("/script-src 'self'/", $csp);
        $this->assertStringNotContainsString('unpkg.com', $csp);
    }
}
