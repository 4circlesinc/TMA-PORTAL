<?php

namespace Tests\Feature;

use App\Support\Mail\InlineImages;
use App\Support\Mail\SignatureImages;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Signature pictures live in object storage, not in users.preferences.
 *
 * The column is read by everything that loads a user, so a logo pasted into
 * a signature used to make one row 5.4 MB and slowed every listing that
 * touched it. These prove the bytes leave the column, come back for the
 * people who should see them, and still reach a recipient's inbox.
 */
class SignatureImageStorageTest extends TestCase
{
    use RefreshDatabase;

    /** A real 1x1 PNG, so decoding is exercised rather than faked. */
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(config('filesystems.avatar_disk', 'public'));
    }

    public function test_a_pasted_image_is_stored_and_the_html_keeps_a_url(): void
    {
        $html = '<div>Best regards<img src="data:image/png;base64,'.self::PNG.'"></div>';

        $stored = SignatureImages::store($html);

        $this->assertStringNotContainsString('data:image/', $stored, 'the base64 must not survive into the column');
        $this->assertMatchesRegularExpression('#src="/media/signatures/[a-f0-9-]{36}\.png"#', $stored);
        $this->assertStringContainsString('Best regards', $stored, 'the rest of the signature is untouched');

        // Far smaller than the base64 it replaced.
        $this->assertLessThan(strlen($html), strlen($stored));

        $files = Storage::disk(config('filesystems.avatar_disk', 'public'))
            ->files(SignatureImages::PREFIX);
        $this->assertCount(1, $files);
    }

    public function test_the_same_picture_twice_is_stored_once(): void
    {
        $img = '<img src="data:image/png;base64,'.self::PNG.'">';

        $stored = SignatureImages::store('<div>'.$img.' and again '.$img.'</div>');

        preg_match_all('#/media/signatures/([a-f0-9-]{36}\.png)#', $stored, $m);

        $this->assertCount(2, $m[1], 'both tags still point at a picture');
        $this->assertSame($m[1][0], $m[1][1], 'and at the same one');
        $this->assertCount(
            1,
            Storage::disk(config('filesystems.avatar_disk', 'public'))->files(SignatureImages::PREFIX),
        );
    }

    public function test_a_signature_with_no_pictures_is_returned_unchanged(): void
    {
        $html = '<div>Chen Wei<br><a href="https://example.com">example.com</a></div>';

        $this->assertSame($html, SignatureImages::store($html));
        $this->assertSame([], Storage::disk(config('filesystems.avatar_disk', 'public'))
            ->files(SignatureImages::PREFIX));
    }

    public function test_an_image_too_large_to_be_a_signature_is_left_alone(): void
    {
        // Bigger than MAX_BYTES once decoded: left as it was rather than
        // stored, so the length cap upstream is what deals with it.
        $huge = base64_encode(str_repeat('x', SignatureImages::MAX_BYTES + 1));
        $html = '<img src="data:image/png;base64,'.$huge.'">';

        $this->assertSame($html, SignatureImages::store($html));
        $this->assertSame([], Storage::disk(config('filesystems.avatar_disk', 'public'))
            ->files(SignatureImages::PREFIX));
    }

    public function test_undecodable_base64_is_left_alone(): void
    {
        $html = '<img src="data:image/png;base64,!!!not-base64!!!">';

        $this->assertSame($html, SignatureImages::store($html));
    }

    /**
     * The one that matters for people outside the portal.
     *
     * A recipient has no session here, so a /media/ URL would render as a
     * broken image in their client. The send path must put the bytes back.
     */
    public function test_sending_turns_a_stored_picture_into_a_real_attachment(): void
    {
        $stored = SignatureImages::store('<div>Regards<img src="data:image/png;base64,'.self::PNG.'"></div>');
        $this->assertStringContainsString('/media/signatures/', $stored);

        [$html, $parts] = InlineImages::extract($stored);

        $this->assertCount(1, $parts, 'the picture travels as an inline attachment');
        $this->assertSame('image/png', $parts[0]['mime']);
        $this->assertSame(base64_decode(self::PNG, true), $parts[0]['bytes'], 'and the bytes are the original');

        $this->assertStringContainsString('cid:'.$parts[0]['cid'], $html);
        $this->assertStringNotContainsString('/media/signatures/', $html, 'no portal URL reaches the recipient');
        $this->assertStringNotContainsString('data:image/', $html);
    }

    public function test_a_missing_object_leaves_the_signature_readable(): void
    {
        $stored = SignatureImages::store('<div>Regards<img src="data:image/png;base64,'.self::PNG.'"></div>');

        Storage::disk(config('filesystems.avatar_disk', 'public'))
            ->deleteDirectory(SignatureImages::PREFIX);

        [$html, $parts] = InlineImages::extract($stored);

        $this->assertSame([], $parts);
        $this->assertStringContainsString('Regards', $html, 'the words survive a lost picture');
    }

    public function test_the_route_serves_a_stored_picture_to_a_signed_in_person(): void
    {
        $stored = SignatureImages::store('<img src="data:image/png;base64,'.self::PNG.'">');
        preg_match('#/media/signatures/([a-f0-9-]{36}\.png)#', $stored, $m);

        $user = \App\Models\User::factory()->create([
            'status' => 'approved',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $response = $this->actingAs($user)->get('/media/signatures/'.$m[1]);

        $response->assertOk();
        $response->assertHeader('Content-Type', 'image/png');
        $this->assertSame(base64_decode(self::PNG, true), $response->streamedContent());
    }

    public function test_the_route_refuses_a_name_that_is_not_ours(): void
    {
        $user = \App\Models\User::factory()->create([
            'status' => 'approved',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($user)->get('/media/signatures/not-a-uuid.png')->assertNotFound();
        $this->actingAs($user)->get('/media/signatures/00000000-0000-0000-0000-000000000000.png')->assertNotFound();
    }

    public function test_the_route_is_closed_to_anyone_not_signed_in(): void
    {
        $stored = SignatureImages::store('<img src="data:image/png;base64,'.self::PNG.'">');
        preg_match('#/media/signatures/([a-f0-9-]{36}\.png)#', $stored, $m);

        // 401 rather than a redirect: this is fetched by an <img>, and a
        // login page delivered as image bytes helps nobody.
        $this->getJson('/media/signatures/'.$m[1])->assertUnauthorized();
    }
}
