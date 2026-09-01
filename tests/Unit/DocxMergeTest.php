<?php

namespace Tests\Unit;

use App\Support\Documents\DocxMerge;
use PHPUnit\Framework\TestCase;

class DocxMergeTest extends TestCase
{
    public function test_a_plain_token_is_filled_and_escaped(): void
    {
        $xml = '<w:t>Dear {{provider}},</w:t>';

        $this->assertSame(
            '<w:t>Dear Arton Capital &amp; Co,</w:t>',
            DocxMerge::fillXml($xml, ['provider' => 'Arton Capital & Co']),
        );
    }

    public function test_a_token_word_split_across_runs_is_stitched_and_filled(): void
    {
        // Word splits typed text into runs wherever it likes — this is the
        // shape a real document.xml takes after ordinary editing.
        $xml = '<w:r><w:t>{{prov</w:t></w:r><w:r><w:rPr/><w:t>ider}}</w:t></w:r>';

        $filled = DocxMerge::fillXml($xml, ['provider' => 'Arton Capital']);

        $this->assertStringContainsString('Arton Capital', $filled);
        $this->assertStringNotContainsString('{{', $filled);
    }

    public function test_an_unknown_code_stays_visible(): void
    {
        $xml = '<w:t>{{nonsense}}</w:t>';

        $this->assertSame($xml, DocxMerge::fillXml($xml, ['provider' => 'Arton']));
    }

    public function test_braces_that_are_not_a_token_are_left_alone(): void
    {
        $xml = '<w:t>a set {1, 2} and {{not closed</w:t>';

        $this->assertSame($xml, DocxMerge::fillXml($xml, ['provider' => 'Arton']));
    }
}
