<?php

namespace Tests\Unit;

use App\Support\Mail\MimeBuilder;
use Tests\TestCase;

class MimeBuilderTest extends TestCase
{
    public function test_a_reply_carries_rfc_in_reply_to_and_references(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'dana@example.com', 'name' => 'Dana']],
            'subject' => 'Re: Quarterly review',
            'bodyHtml' => '<p>Sounds good.</p>',
            'inReplyTo' => '<CAE123@mail.gmail.com>',
            'references' => '<CAE000@mail.gmail.com> <CAE123@mail.gmail.com>',
        ]);

        $this->assertStringContainsString("In-Reply-To: <CAE123@mail.gmail.com>\r\n", $mime);
        $this->assertStringContainsString("References: <CAE000@mail.gmail.com> <CAE123@mail.gmail.com>\r\n", $mime);
        $this->assertStringContainsString('Re: Quarterly review', $mime);
    }

    public function test_a_bare_message_id_is_wrapped_in_angle_brackets(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'dana@example.com']],
            'subject' => 'Re: Hello',
            'inReplyTo' => 'id@mail.example.com',
        ]);

        $this->assertStringContainsString("In-Reply-To: <id@mail.example.com>\r\n", $mime);
        $this->assertStringContainsString("References: <id@mail.example.com>\r\n", $mime);
    }

    public function test_a_provider_internal_id_is_not_emitted_as_a_threading_header(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'dana@example.com']],
            'subject' => 'Re: Hello',
            'inReplyTo' => '18c4f2a3b8d9e0f1',
            'messageId' => '18c4f2a3b8d9e0f1',
        ]);

        $this->assertStringNotContainsString('In-Reply-To:', $mime);
        $this->assertStringNotContainsString('References:', $mime);
    }

    public function test_a_new_message_has_no_threading_headers(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'client@example.com']],
            'subject' => 'Invoice attached',
            'bodyHtml' => '<p>Please find it enclosed.</p>',
        ]);

        $this->assertStringNotContainsString('In-Reply-To:', $mime);
        $this->assertStringNotContainsString('References:', $mime);
        $this->assertStringContainsString('client@example.com', $mime);
    }

    public function test_a_plain_body_stays_a_single_part(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'client@example.com']],
            'subject' => 'Hello',
            'bodyHtml' => '<p>No images here.</p>',
        ]);

        $this->assertStringNotContainsString('multipart/related', $mime);
        $this->assertStringNotContainsString('Content-ID:', $mime);
    }

    public function test_a_data_uri_image_becomes_a_cid_inline_part(): void
    {
        // Minimal valid 1x1 PNG.
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

        $mime = MimeBuilder::build([
            'to' => [['email' => 'client@example.com']],
            'subject' => 'With signature',
            'bodyHtml' => '<p>Regards</p><img src="data:image/png;base64,'
                .base64_encode($png).'" width="120" alt="Logo">',
        ]);

        $this->assertStringContainsString('multipart/related', $mime);
        $this->assertStringContainsString('Content-ID: <tma-inline-1-', $mime);
        $this->assertStringContainsString('Content-Disposition: inline; filename="inline-1.png"', $mime);
        $this->assertStringNotContainsString('data:image/png', $mime);

        // The HTML part must reference the attachment it now travels beside.
        $html = $this->htmlPart($mime);
        $this->assertStringContainsString('src="cid:tma-inline-1-', $html);
        $this->assertStringNotContainsString('data:image/png', $html);

        // And the image part must carry the original bytes.
        $this->assertStringContainsString(chunk_split(base64_encode($png), 76, "\r\n"), $mime);
    }

    public function test_repeated_images_collapse_to_one_inline_part(): void
    {
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
        $img = '<img src="data:image/png;base64,'.base64_encode($png).'">';

        $mime = MimeBuilder::build([
            'to' => [['email' => 'client@example.com']],
            'subject' => 'Reply carrying the quoted signature too',
            'bodyHtml' => '<p>Top</p>'.$img.'<blockquote>'.$img.'</blockquote>',
        ]);

        $this->assertSame(1, substr_count($mime, 'Content-ID:'));
        $this->assertSame(2, substr_count($this->htmlPart($mime), 'src="cid:tma-inline-1-'));
    }

    public function test_an_undecodable_data_uri_is_left_alone(): void
    {
        $mime = MimeBuilder::build([
            'to' => [['email' => 'client@example.com']],
            'subject' => 'Broken image',
            'bodyHtml' => '<img src="data:image/png;base64,@@not-base64@@">',
        ]);

        $this->assertStringNotContainsString('multipart/related', $mime);
        $this->assertStringNotContainsString('Content-ID:', $mime);
    }

    /** Decoded HTML part of a multipart/related message. */
    private function htmlPart(string $mime): string
    {
        preg_match('/boundary="([^"]+)"/', $mime, $match);
        $this->assertNotEmpty($match[1] ?? '', 'expected a multipart boundary');

        foreach (explode('--'.$match[1], $mime) as $part) {
            if (str_contains($part, 'Content-Type: text/html')) {
                [, $body] = explode("\r\n\r\n", $part, 2);

                return base64_decode(preg_replace('/\s+/', '', $body), true) ?: '';
            }
        }

        $this->fail('no text/html part found');
    }
}
