<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Branding;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Settings → Account and Reporting → Edit Company Branding.
 *
 * Branding used to be written to localStorage, so it applied to exactly one
 * browser — the administrator's. What matters here is the opposite: that a
 * save reaches the whole firm, that everyone can *read* it while only
 * administrators can change it, and that the colours cannot carry anything but
 * a colour into the style attribute the browser writes them into.
 */
class BrandingTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', string $email = 'admin@example.com'): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function save(User $as, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as)->putJson('/admin/branding', array_merge([
            'accountName' => 'Antoine & Partners',
            'pageTitle' => 'Antoine & Partners — Client Portal',
            'headerColor' => '#101820',
            'accentColor' => '#C8A24A',
        ], $body));
    }

    /**
     * A logo is a real multipart upload, so it cannot go through postJson.
     * The Accept header is what the settings page sends, and what makes a
     * rejected file answer 422 rather than redirecting.
     */
    private function uploadLogo(User $as, UploadedFile $file): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($as)->post('/admin/branding/logo', ['logo' => $file], ['Accept' => 'application/json']);
    }

    public function test_it_starts_on_the_portal_defaults(): void
    {
        $this->actingAs($this->user())->getJson('/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.accountName', Branding::DEFAULTS['accountName'])
            ->assertJsonPath('branding.accentColor', Branding::DEFAULTS['accentColor'])
            ->assertJsonPath('branding.logo', null);
    }

    public function test_an_administrator_saves_branding_for_the_whole_firm(): void
    {
        $admin = $this->user();
        $employee = $this->user('Employee', 'sam@example.com');

        $this->save($admin)->assertOk()->assertJsonPath('branding.accountName', 'Antoine & Partners');

        // It persisted, rather than living in the administrator's browser…
        $this->assertDatabaseHas('portal_settings', ['key' => 'branding']);

        // …and everybody else reads the same thing.
        $this->actingAs($employee)->getJson('/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.pageTitle', 'Antoine & Partners — Client Portal')
            ->assertJsonPath('branding.accentColor', '#C8A24A');
    }

    public function test_only_administrators_can_change_branding(): void
    {
        foreach (['Employee', 'Client'] as $type) {
            $user = $this->user($type, mb_strtolower($type).'@example.com');

            // Reading is open — branding is chrome every account's shell paints.
            $this->actingAs($user)->getJson('/admin/branding')->assertOk();

            $this->save($user)->assertForbidden();
            $this->actingAs($user)->postJson('/admin/branding/reset')->assertForbidden();
            $this->actingAs($user)->deleteJson('/admin/branding/logo')->assertForbidden();
        }

        $this->assertDatabaseMissing('portal_settings', ['key' => 'branding']);
    }

    public function test_a_colour_must_be_a_colour(): void
    {
        $admin = $this->user();

        // The browser writes these into a style attribute, so anything that is
        // not a hex triple is refused rather than escaped later.
        $this->save($admin, ['accentColor' => 'red; background:url(javascript:alert(1))'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('accentColor');

        $this->save($admin, ['headerColor' => '#12345'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('headerColor');

        $this->save($admin, ['accountName' => ''])
            ->assertStatus(422)
            ->assertJsonValidationErrors('accountName');
    }

    public function test_a_logo_is_stored_and_served_back_through_the_app(): void
    {
        Storage::fake(Branding::disk());
        $admin = $this->user();

        $response = $this->uploadLogo($admin, UploadedFile::fake()->image('firm-logo.png', 400, 120))->assertOk();

        $url = $response->json('branding.logo');

        // An app URL, never a bucket URL: the disk is shared with the file
        // manager's confidential documents and stays private.
        $this->assertStringStartsWith('/media/'.Branding::LOGO_DIRECTORY.'/', $url);
        $this->assertSame('firm-logo.png', $response->json('branding.logoName'));
        Storage::disk(Branding::disk())->assertExists(ltrim(str_replace('/media/', '', $url), '/'));

        // Any signed-in account can render it.
        $this->actingAs($this->user('Client', 'dana@example.com'))->get($url)->assertOk();
    }

    public function test_replacing_and_removing_a_logo_cleans_up_the_old_file(): void
    {
        Storage::fake(Branding::disk());
        $admin = $this->user();

        $first = $this->uploadLogo($admin, UploadedFile::fake()->image('old.png'))->json('branding.logo');
        $second = $this->uploadLogo($admin, UploadedFile::fake()->image('new.png'))->json('branding.logo');

        $path = fn (string $url) => ltrim(str_replace('/media/', '', $url), '/');

        Storage::disk(Branding::disk())->assertMissing($path($first));
        Storage::disk(Branding::disk())->assertExists($path($second));

        $this->actingAs($admin)->deleteJson('/admin/branding/logo')
            ->assertOk()
            ->assertJsonPath('branding.logo', null);

        Storage::disk(Branding::disk())->assertMissing($path($second));
    }

    public function test_a_logo_must_be_a_real_image_within_the_size_limit(): void
    {
        Storage::fake(Branding::disk());
        $admin = $this->user();

        // An SVG is a script container, and this file is streamed back to
        // every account's browser as page chrome.
        $this->uploadLogo($admin, UploadedFile::fake()->create('payload.svg', 4, 'image/svg+xml'))
            ->assertStatus(422)
            ->assertJsonValidationErrors('logo');

        $this->uploadLogo($admin, UploadedFile::fake()->image('huge.png')->size(4096))
            ->assertStatus(422)
            ->assertJsonValidationErrors('logo');
    }

    public function test_use_portal_defaults_restores_the_appearance_but_keeps_the_firms_name(): void
    {
        Storage::fake(Branding::disk());
        $admin = $this->user();

        $this->save($admin)->assertOk();
        $logo = $this->uploadLogo($admin, UploadedFile::fake()->image('logo.png'))->json('branding.logo');

        $reset = $this->actingAs($admin)->postJson('/admin/branding/reset')->assertOk()->json('branding');

        $this->assertSame(Branding::DEFAULTS['pageTitle'], $reset['pageTitle']);
        $this->assertSame(Branding::DEFAULTS['accentColor'], $reset['accentColor']);
        $this->assertNull($reset['logo']);
        Storage::disk(Branding::disk())->assertMissing(ltrim(str_replace('/media/', '', $logo), '/'));

        // The button lives under "Edit Account Appearance", so it must not wipe
        // the firm's name out from under the administrator.
        $this->assertSame('Antoine & Partners', $reset['accountName']);
    }

    public function test_the_logo_route_refuses_names_it_did_not_generate(): void
    {
        Storage::fake(Branding::disk());

        $this->actingAs($this->user())->get('/media/branding/..%2F..%2Fsecret.png')->assertNotFound();
        $this->actingAs($this->user('Employee', 'sam@example.com'))->get('/media/branding/anything.png')->assertNotFound();
    }

    public function test_a_save_is_not_lost_to_a_reader_that_cached_the_row_late(): void
    {
        $admin = $this->user();
        // The read-through cache Branding::get() fills. Named here because the
        // whole point of this test is what another request can put in it.
        $cacheKey = 'portal-settings.branding';

        $this->save($admin, ['accountName' => 'Antoine & Partners'])->assertOk();

        /*
         * Branding is read on every shell boot, so a reader is nearly always
         * in flight when an administrator saves. This is the one that loses the
         * race: it read the table *before* the save and writes what it found
         * into the cache *after* it. Invalidating on write cannot help — the
         * stale entry is created afterwards.
         */
        Cache::put($cacheKey, ['accountName' => 'Old Name', 'pageTitle' => 'Old Title'], 300);

        /*
         * A logo upload writes only the two logo fields, so it has to merge
         * over the *table*. Merging over that cache entry instead is how a save
         * came undone: the administrator saved the firm's name, uploaded the
         * logo a moment later, and the name reverted with no error anywhere.
         */
        Storage::fake(Branding::disk());
        $branding = $this->uploadLogo($admin, UploadedFile::fake()->image('logo.png'))
            ->assertOk()->json('branding');

        $this->assertSame('Antoine & Partners', $branding['accountName']);
        $this->assertSame('Antoine & Partners — Client Portal', $branding['pageTitle']);

        // And a write leaves the cache holding what it just wrote, so the next
        // reader — including the administrator reloading — sees it.
        $this->assertSame('Antoine & Partners', Cache::get($cacheKey)['accountName']);
        $this->actingAs($admin)->getJson('/admin/branding')
            ->assertOk()
            ->assertJsonPath('branding.accountName', 'Antoine & Partners');
    }

    public function test_stored_branding_survives_a_partial_edit(): void
    {
        $admin = $this->user();

        // A row written by an older version, or by a future field this build
        // does not know about, must not be clobbered by an unrelated save.
        DB::table('portal_settings')->insert([
            'key' => 'branding',
            'value' => json_encode(['accountName' => 'Old Name', 'logo' => '/media/branding/keep.png', 'logoName' => 'keep.png']),
            'updated_at' => now(),
        ]);

        $branding = $this->save($admin, ['accountName' => 'New Name'])->assertOk()->json('branding');

        $this->assertSame('New Name', $branding['accountName']);
        $this->assertSame('/media/branding/keep.png', $branding['logo']);
    }
}
