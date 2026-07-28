<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The download links behind the portal's "get the app" card.
 *
 * The filename in the bucket carries the version and the architecture, so
 * nothing in the UI may hard-code it. These tests pin the two properties the
 * card depends on: the link follows whatever the manifest currently names, and
 * a platform we do not build yet reports itself unavailable instead of handing
 * out a dead link.
 */
class DesktopReleasesTest extends TestCase
{
    use RefreshDatabase;

    private const MAC_MANIFEST = <<<'YML'
    version: 0.8.0
    files:
      - url: TM ANTOINE Portal-0.8.0-arm64-mac.zip
        sha512: aaa==
        size: 95637041
      - url: TM ANTOINE Portal-0.8.0-arm64.dmg
        sha512: bbb==
        size: 99771056
    path: TM ANTOINE Portal-0.8.0-arm64-mac.zip
    releaseDate: '2026-07-28T12:23:11.521Z'
    YML;

    private function publishMac(): void
    {
        Storage::disk(config('filesystems.files_disk'))
            ->put('desktop/latest-mac.yml', self::MAC_MANIFEST);
    }

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(config('filesystems.files_disk'));
    }

    public function test_it_reports_the_published_mac_build(): void
    {
        $this->publishMac();

        $this->getJson('/desktop/releases')
            ->assertOk()
            ->assertJsonPath('mac.available', true)
            ->assertJsonPath('mac.version', '0.8.0')
            ->assertJsonPath('mac.url', route('desktop.download', 'mac'));
    }

    /** No Windows build is produced yet, and the card must be told so. */
    public function test_it_reports_windows_as_unavailable(): void
    {
        $this->publishMac();

        $this->getJson('/desktop/releases')
            ->assertOk()
            ->assertJsonPath('windows.available', false);
    }

    public function test_it_reports_nothing_when_the_bucket_is_empty(): void
    {
        $this->getJson('/desktop/releases')
            ->assertOk()
            ->assertJsonPath('mac.available', false)
            ->assertJsonPath('windows.available', false);
    }

    /**
     * The installer, not the archive: the .zip exists only so electron-updater
     * can patch an installed copy, and double-clicking it does nothing useful.
     */
    public function test_downloading_mac_lands_on_the_current_installer(): void
    {
        $this->publishMac();

        $this->get('/desktop/download/mac')
            ->assertRedirect(route('desktop.update', 'TM ANTOINE Portal-0.8.0-arm64.dmg'));
    }

    public function test_downloading_an_unbuilt_platform_is_a_404(): void
    {
        $this->publishMac();

        $this->get('/desktop/download/windows')->assertNotFound();
    }

    public function test_it_rejects_platforms_it_does_not_know(): void
    {
        $this->get('/desktop/download/linux')->assertNotFound();
    }

    /** The feed the installed app polls must still be reachable by filename. */
    public function test_the_update_feed_still_serves_the_manifest(): void
    {
        $this->publishMac();

        $this->get('/desktop/latest-mac.yml')
            ->assertOk()
            ->assertSee('version: 0.8.0');
    }
}
