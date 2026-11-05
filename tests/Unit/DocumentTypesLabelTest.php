<?php

namespace Tests\Unit;

use App\Support\Cip\DocumentTypes;
use Tests\TestCase;

/**
 * Document names a reader sees: SL form codes with a capital L, and the
 * same capitalization on every checklist name.
 */
class DocumentTypesLabelTest extends TestCase
{
    public function test_form_codes_read_as_sl_with_a_capital_l(): void
    {
        $this->assertSame('SL1 Form', DocumentTypes::label('sl1_form'));
        $this->assertSame('SL2A Form', DocumentTypes::label('sl2a_form'));
        $this->assertSame('SL2B Form', DocumentTypes::label('sl2b_form'));
        $this->assertSame('SL4 Form', DocumentTypes::label('sl4_form'));

        $this->assertSame('SL1 Form', DocumentTypes::present('Sl1 form'));
        $this->assertSame('SL1 Form', DocumentTypes::present('SI1 Form'));
        $this->assertSame('SL2A Form', DocumentTypes::present('Sl2a form'));
        $this->assertSame('Affidavit of Support (Formerly SL7A)', DocumentTypes::present('Affidavit of Support (Formerly SL7a)'));
    }

    public function test_document_names_use_one_capitalization(): void
    {
        $this->assertSame('Birth Certificate', DocumentTypes::label(DocumentTypes::BIRTH_CERTIFICATE));
        $this->assertSame('Passport Photo', DocumentTypes::label(DocumentTypes::PASSPORT_PHOTO));
        $this->assertSame('Passport Bio Page', DocumentTypes::label(DocumentTypes::PASSPORT_BIO_PAGE));
        $this->assertSame('Police Certificate', DocumentTypes::label('police_certificate'));

        $this->assertSame(
            'Certified Copy of Passport Bio Data Page',
            DocumentTypes::present('Certified copy of passport bio data page'),
        );
        $this->assertSame(
            'Four Physical Passport-Sized Photos',
            DocumentTypes::present('Four physical passport-sized photos'),
        );
        $this->assertSame('Completed ePP Form', DocumentTypes::present('Completed ePP Form'));
        $this->assertSame(
            'Scanned Copy of a Passport-Sized Photo (JPEG or PNG & PDF)',
            DocumentTypes::present('Scanned Copy of a Passport-Sized Photo (JPEG or PNG & PDF)'),
        );
    }

    public function test_a_sentence_keeps_its_words_and_only_the_form_code_changes(): void
    {
        $this->assertSame(
            'Ada Admin replaced SL4 Form with version 2',
            DocumentTypes::presentFormCodes('Ada Admin replaced Sl4 form with version 2'),
        );
        $this->assertSame(
            'Rita Officer sent back Police certificate',
            DocumentTypes::presentFormCodes('Rita Officer sent back Police certificate'),
        );
    }
}
