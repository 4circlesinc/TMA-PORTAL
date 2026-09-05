<?php

namespace Tests\Unit;

use App\Support\Mail\DraftContent;
use Tests\TestCase;

class DraftContentTest extends TestCase
{
    public function test_a_signature_only_body_is_blank(): void
    {
        $signature = '<div data-email-signature><br>Kind Regards,<br>This Electronic Mail and any attached files may contain confidential information.</div>';

        $this->assertTrue(DraftContent::isBlank([
            'to' => [],
            'subject' => '',
            'bodyHtml' => $signature,
        ], $signature));
    }

    public function test_a_recipient_makes_a_draft_worth_saving(): void
    {
        $this->assertFalse(DraftContent::isBlank([
            'to' => [['email' => 'dana@example.com']],
            'subject' => '',
            'bodyHtml' => '<div data-email-signature>Kind Regards</div>',
        ], 'Kind Regards'));
    }

    public function test_a_subject_makes_a_draft_worth_saving(): void
    {
        $this->assertFalse(DraftContent::isBlank([
            'to' => [],
            'subject' => 'Hello',
            'bodyHtml' => '',
        ]));
    }

    public function test_typed_body_beyond_the_signature_is_kept(): void
    {
        $this->assertFalse(DraftContent::isBlank([
            'to' => [],
            'subject' => '',
            'bodyHtml' => '<p>Please review the attached invoice.</p><div data-email-signature>Kind Regards</div>',
        ], 'Kind Regards'));
    }

    public function test_a_file_attachment_makes_a_draft_worth_saving(): void
    {
        $this->assertFalse(DraftContent::isBlank([
            'to' => [],
            'subject' => '',
            'bodyHtml' => '<div data-email-signature>Kind Regards</div>',
            'attachments' => [[
                'name' => 'invoice.pdf',
                'mime' => 'application/pdf',
                'bytes' => '%PDF-1.4 fake',
            ]],
        ], 'Kind Regards'));
    }

    public function test_a_disclaimer_preview_is_a_husk(): void
    {
        $this->assertTrue(DraftContent::isHusk([
            'folder' => 'draft',
            'to' => [],
            'subject' => '',
            'snippet' => 'This Electronic Mail and any attached files may contain confidential information.',
        ]));
    }

    public function test_inbox_mail_is_never_a_husk(): void
    {
        $this->assertFalse(DraftContent::isHusk([
            'folder' => 'inbox',
            'to' => [],
            'subject' => '',
            'snippet' => 'This Electronic Mail and any attached files may contain confidential information.',
        ]));
    }

    public function test_clean_name_drops_the_literal_word_null(): void
    {
        $this->assertNull(DraftContent::cleanName('null'));
        $this->assertNull(DraftContent::cleanName(null));
        $this->assertSame('Vernon Francis', DraftContent::cleanName('Vernon Francis'));
    }
}
