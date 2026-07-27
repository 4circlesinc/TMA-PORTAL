<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The update feed the installed macOS app polls.
 *
 * Unauthenticated by necessity — the app has no session when it checks — and
 * it serves files out of a bucket, so the interesting cases are all about what
 * it refuses to serve.
 */
class DesktopUpdateFeedTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake(config('filesystems.files_disk'));
    }

    public function test_it_serves_the_manifest_to_anyone(): void
    {
        Storage::disk(config('filesystems.files_disk'))
            ->put('desktop/latest-mac.yml', "version: 1.2.3\n");

        $this->get('/desktop/latest-mac.yml')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/yaml; charset=utf-8')
            ->assertSee('version: 1.2.3');
    }

    public function test_a_missing_build_is_not_found(): void
    {
        $this->get('/desktop/latest-mac.yml')->assertNotFound();
    }

    public function test_it_refuses_anything_that_is_not_a_build(): void
    {
        $disk = Storage::disk(config('filesystems.files_disk'));
        $disk->put('desktop/.env', 'APP_KEY=secret');
        $disk->put('desktop/notes.txt', 'hello');

        $this->get('/desktop/.env')->assertNotFound();
        $this->get('/desktop/notes.txt')->assertNotFound();
    }

    public function test_it_cannot_be_walked_out_of_its_prefix(): void
    {
        $this->get('/desktop/..%2F..%2F.env')->assertNotFound();
        $this->get('/desktop/'.urlencode('../.env'))->assertNotFound();
    }
}
