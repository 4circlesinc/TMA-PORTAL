<?php

namespace App\Support\Signatures;

use App\Models\FileItem;
use App\Models\SignatureField;
use App\Models\SignatureRequest;
use App\Support\Files\Vault;
use setasign\Fpdi\Fpdi;
use setasign\Fpdi\PdfParser\PdfParserException;

/**
 * Writes the collected field values into a copy of the original PDF.
 *
 * The original is never touched: this produces new bytes, and the caller saves
 * them as a separate library file. Positions come back out of the same
 * page-relative fractions (0..1) the editor stored, which is why the editor's
 * render scale and this one never have to agree on pixels.
 *
 * PNG/JPG documents are wrapped into a single-page PDF first, so everything
 * downstream is uniformly a PDF.
 */
class Stamper
{
    /** FPDF works in millimetres; PDF points are 1/72". */
    private const MM_PER_PT = 0.352777778;

    /** Leave a hair of padding so glyphs don't touch the field border. */
    private const TEXT_FIT = 0.62;

    private const MIN_FONT_PT = 5.0;

    private const MAX_FONT_PT = 22.0;

    /**
     * Render the signed document and return an absolute temp path.
     * The caller owns the file (Vault::store consumes it).
     *
     * @throws StampingException
     */
    public static function stamp(SignatureRequest $request): string
    {
        $file = $request->file;
        if (! $file) {
            throw new StampingException('The original document is no longer available.');
        }

        $source = Vault::localCopy($file);
        if (! $source) {
            throw new StampingException('The original document could not be read.');
        }

        $isImage = Signable::needsConversion($file);
        $fields = $request->fields()->with('recipient')->get()->groupBy('page');
        $temps = [];

        try {
            $pdf = new Fpdi;
            $pdf->SetAutoPageBreak(false);
            // Nothing here is user-facing chrome; the output should look like
            // the original document, plus signatures.
            $pdf->SetMargins(0, 0, 0);

            // FPDF only ever draws on the page it's currently on - there is no
            // seeking back to an earlier one - so each page's fields go down as
            // soon as that page exists.
            $onPage = function (int $pageNo, array $size) use ($pdf, $fields, &$temps) {
                foreach ($fields->get($pageNo, []) as $field) {
                    self::drawField($pdf, $field, $size, $temps);
                }
            };

            $isImage
                ? self::renderImageDocument($pdf, $source, $onPage)
                : self::renderPdfDocument($pdf, $source, $onPage);

            $out = self::tempPath('signed', 'pdf');
            $pdf->Output('F', $out);

            return $out;
        } catch (PdfParserException $e) {
            // Encrypted or otherwise unreadable. Should have been caught at
            // send time; if it wasn't, say so plainly rather than half-write.
            throw new StampingException(
                'This PDF can\'t be stamped — it may be password-protected or damaged.',
                previous: $e,
            );
        } finally {
            foreach ($temps as $tmp) {
                @unlink($tmp);
            }
        }
    }

    /** True when FPDI can actually parse this document. Checked before sending. */
    public static function canStamp(FileItem $file): bool
    {
        if (Signable::needsConversion($file)) {
            return true; // images are rebuilt, not parsed
        }

        $path = Vault::localCopy($file);
        if (! $path) {
            return false;
        }

        try {
            $pdf = new Fpdi;

            return $pdf->setSourceFile($path) > 0;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Import every page of the source PDF at its own size, calling $onPage
     * with each one while it's the current page.
     */
    private static function renderPdfDocument(Fpdi $pdf, string $source, callable $onPage): void
    {
        $count = $pdf->setSourceFile($source);

        for ($page = 1; $page <= $count; $page++) {
            $tpl = $pdf->importPage($page);
            $size = $pdf->getTemplateSize($tpl);

            // Keep each page's own geometry - a landscape page in a portrait
            // document must not be squashed.
            $pdf->AddPage($size['orientation'], [$size['width'], $size['height']]);
            $pdf->useTemplate($tpl);

            $onPage($page, ['width' => (float) $size['width'], 'height' => (float) $size['height']]);
        }
    }

    /**
     * Wrap an image into one PDF page the same shape as the image, so the
     * editor's fractions land where the author put them.
     */
    private static function renderImageDocument(Fpdi $pdf, string $source, callable $onPage): void
    {
        $info = @getimagesize($source);
        if (! $info) {
            throw new StampingException('That image could not be read.');
        }

        // 96 dpi is the browser's assumption, and the browser is what the
        // author placed fields against.
        $width = $info[0] / 96 * 25.4;
        $height = $info[1] / 96 * 25.4;

        $pdf->AddPage($width >= $height ? 'L' : 'P', [$width, $height]);
        $pdf->Image($source, 0, 0, $width, $height, self::imageType($info[2]));

        $onPage(1, ['width' => $width, 'height' => $height]);
    }

    private static function imageType(int $imageType): string
    {
        return match ($imageType) {
            IMAGETYPE_PNG => 'PNG',
            IMAGETYPE_JPEG => 'JPEG',
            IMAGETYPE_GIF => 'GIF',
            default => throw new StampingException('That image format can\'t be signed.'),
        };
    }

    /**
     * @param  array{width: float, height: float}  $size
     * @param  array<int, string>  $temps
     */
    private static function drawField(Fpdi $pdf, SignatureField $field, array $size, array &$temps): void
    {
        $value = $field->value;
        if ($value === null || $value === '') {
            return; // optional and skipped
        }

        // Fractions -> millimetres. This is the whole contract between the
        // editor and this file.
        $x = $field->x * $size['width'];
        $y = $field->y * $size['height'];
        $w = $field->width * $size['width'];
        $h = $field->height * $size['height'];

        match ($field->type) {
            FieldType::SIGNATURE, FieldType::INITIALS => self::drawImage($pdf, $value, $x, $y, $w, $h, $temps),
            FieldType::CHECKBOX => self::drawCheck($pdf, $x, $y, $w, $h),
            default => self::drawText($pdf, $value, $x, $y, $w, $h),
        };
    }

    /** @param array<int, string> $temps */
    private static function drawImage(Fpdi $pdf, string $dataUrl, float $x, float $y, float $w, float $h, array &$temps): void
    {
        if (! preg_match('#^data:image/png;base64,(.+)$#', $dataUrl, $m)) {
            return; // FieldValue already rejected anything else; be quiet here
        }

        $binary = base64_decode($m[1], true);
        if ($binary === false || $binary === '') {
            return;
        }

        $tmp = self::tempPath('sig', 'png');
        file_put_contents($tmp, $binary);
        $temps[] = $tmp;

        $info = @getimagesize($tmp);
        if (! $info) {
            return;
        }

        // Fit inside the box without distorting the signature, and centre it -
        // a stretched signature looks forged.
        $scale = min($w / $info[0], $h / $info[1]);
        $drawW = $info[0] * $scale;
        $drawH = $info[1] * $scale;

        $pdf->Image($tmp, $x + ($w - $drawW) / 2, $y + ($h - $drawH) / 2, $drawW, $drawH, 'PNG');
    }

    private static function drawCheck(Fpdi $pdf, float $x, float $y, float $w, float $h): void
    {
        // ZapfDingbats '4' is a check mark, and it ships with every PDF
        // reader - no font to embed.
        $pt = self::fitFont($h);
        $pdf->SetFont('ZapfDingbats', '', $pt);
        $pdf->SetTextColor(0, 0, 0);
        $pdf->SetXY($x, $y);
        $pdf->Cell($w, $h, '4', 0, 0, 'C');
    }

    private static function drawText(Fpdi $pdf, string $value, float $x, float $y, float $w, float $h): void
    {
        $pt = self::fitFont($h);
        $pdf->SetFont('Helvetica', '', $pt);
        $pdf->SetTextColor(0, 0, 0);

        $text = self::latin1($value);

        // Shrink to fit rather than spill past the field the author drew.
        while ($pt > self::MIN_FONT_PT && $pdf->GetStringWidth($text) > $w) {
            $pt -= 0.5;
            $pdf->SetFont('Helvetica', '', $pt);
        }

        $pdf->SetXY($x, $y);
        $pdf->Cell($w, $h, $text, 0, 0, 'L');
    }

    private static function fitFont(float $heightMm): float
    {
        $pt = ($heightMm / self::MM_PER_PT) * self::TEXT_FIT;

        return max(self::MIN_FONT_PT, min(self::MAX_FONT_PT, $pt));
    }

    /**
     * FPDF's core fonts are Latin-1 only.
     *
     * Transliterating keeps "José" readable as "Jose" instead of rendering
     * mojibake. Names that don't transliterate at all (CJK) come out as "?" -
     * embedding a Unicode TTF is the real fix if that ever matters here.
     */
    private static function latin1(string $text): string
    {
        $converted = @iconv('UTF-8', 'ISO-8859-1//TRANSLIT', $text);

        return $converted === false ? preg_replace('/[^\x20-\x7E]/', '', $text) : $converted;
    }

    private static function tempPath(string $prefix, string $ext): string
    {
        $dir = Vault::tempRoot().'/stamp';
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        return $dir.'/'.$prefix.'-'.bin2hex(random_bytes(8)).'.'.$ext;
    }
}
