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
}
