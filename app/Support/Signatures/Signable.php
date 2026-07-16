<?php

namespace App\Support\Signatures;

use App\Models\FileItem;

/**
 * Which library files may be sent for signature.
 *
 * The signing pipeline is PDF-based: PDFs are stamped in place with FPDI, and
 * PNG/JPG are wrapped into a single-page PDF on ingest (FPDF embeds both
 * natively). Formats are allowed here only once that path genuinely exists -
 * an unsupported file must be refused at selection time, not discovered after
 * a recipient has already opened a broken link.
 *
 * GIF/WEBP/BMP are decodable with GD and can be added once the image->PDF
 * conversion step lands; Office documents need a converter and are out.
 */
class Signable
{
    /** Stamped directly, keeping selectable text. */
    public const NATIVE = ['pdf'];

    /** Wrapped into a PDF before any field is placed. */
    public const CONVERTIBLE = ['png', 'jpg', 'jpeg'];

    public static function extensions(): array
    {
        return [...self::NATIVE, ...self::CONVERTIBLE];
    }

    public static function isSignable(?FileItem $file): bool
    {
        if (! $file) {
            return false;
        }

        return self::isSignableExtension((string) $file->extension);
    }

    public static function isSignableExtension(string $extension): bool
    {
        return in_array(strtolower(ltrim($extension, '.')), self::extensions(), true);
    }

    /** True when the file needs converting to PDF before fields are placed. */
    public static function needsConversion(FileItem $file): bool
    {
        return in_array(strtolower((string) $file->extension), self::CONVERTIBLE, true);
    }

    public static function rejectionReason(FileItem $file): string
    {
        return sprintf(
            '%s files can\'t be sent for signature. Supported formats: %s.',
            strtoupper((string) $file->extension ?: 'These'),
            strtoupper(implode(', ', self::extensions())),
        );
    }
}
