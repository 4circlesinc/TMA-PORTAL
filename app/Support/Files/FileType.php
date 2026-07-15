<?php

namespace App\Support\Files;

use RuntimeException;

/**
 * Classifies a file by BOTH its extension and its sniffed MIME type, and
 * rejects dangerous uploads (renamed executables / scripts, MIME spoofing).
 *
 * Never trusts the filename alone: the real content type is read with finfo
 * and cross-checked so a `photo.jpg` that is actually a shell script is caught.
 */
class FileType
{
    /** Hard 2 GB per-file ceiling (bytes). Enforced client- and server-side. */
    public const MAX_BYTES = 2 * 1024 * 1024 * 1024;

    /** extension => [category, icon-key]. Icon keys are resolved by file-icons.js. */
    private const MAP = [
        'pdf'  => ['pdf', 'FilePdf'],
        'doc'  => ['word', 'FileDoc'],    'docx' => ['word', 'FileDoc'],
        'rtf'  => ['word', 'FileDoc'],    'odt'  => ['word', 'FileDoc'],
        'xls'  => ['excel', 'FileXls'],   'xlsx' => ['excel', 'FileXls'],
        'ods'  => ['excel', 'FileXls'],
        'csv'  => ['excel', 'FileCsv'],
        'ppt'  => ['powerpoint', 'FilePpt'], 'pptx' => ['powerpoint', 'FilePpt'],
        'odp'  => ['powerpoint', 'FilePpt'],
        'jpg'  => ['image', 'FileImage'], 'jpeg' => ['image', 'FileImage'],
        'png'  => ['image', 'FileImage'], 'gif'  => ['image', 'FileImage'],
        'webp' => ['image', 'FileImage'], 'bmp'  => ['image', 'FileImage'],
        'tiff' => ['image', 'FileImage'], 'heic' => ['image', 'FileImage'],
        'svg'  => ['image', 'FileImage'],
        'mp4'  => ['video', 'FileVideo'], 'mov'  => ['video', 'FileVideo'],
        'webm' => ['video', 'FileVideo'], 'mkv'  => ['video', 'FileVideo'],
        'avi'  => ['video', 'FileVideo'], 'm4v'  => ['video', 'FileVideo'],
        'mp3'  => ['audio', 'FileAudio'], 'wav'  => ['audio', 'FileAudio'],
        'ogg'  => ['audio', 'FileAudio'], 'm4a'  => ['audio', 'FileAudio'],
        'flac' => ['audio', 'FileAudio'], 'aac'  => ['audio', 'FileAudio'],
        'zip'  => ['archive', 'FileZip'], 'rar'  => ['archive', 'FileZip'],
        '7z'   => ['archive', 'FileZip'], 'tar'  => ['archive', 'FileZip'],
        'gz'   => ['archive', 'FileZip'],
        'txt'  => ['text', 'FileText'],   'md'   => ['text', 'FileText'],
        'log'  => ['text', 'FileText'],
        'json' => ['code', 'FileCode'],   'xml'  => ['code', 'FileCode'],
        'html' => ['code', 'FileCode'],   'css'  => ['code', 'FileCode'],
    ];

    /** Extensions we refuse outright — server- or OS-executable. */
    private const BLOCKED_EXT = [
        'php', 'phtml', 'php3', 'php4', 'php5', 'php7', 'phps', 'pht', 'phar',
        'exe', 'com', 'bat', 'cmd', 'msi', 'scr', 'cpl', 'dll', 'so',
        'sh', 'bash', 'zsh', 'ksh', 'ps1', 'psm1', 'vbs', 'vbe', 'wsf', 'wsh',
        'hta', 'jar', 'apk', 'deb', 'rpm', 'dmg', 'pkg', 'app', 'gadget',
        'lnk', 'reg', 'htaccess', 'htpasswd', 'asp', 'aspx', 'jsp', 'cgi',
    ];

    /** MIME types that are dangerous no matter what the extension claims. */
    private const BLOCKED_MIME = [
        'application/x-httpd-php', 'application/x-php', 'text/x-php',
        'application/x-dosexec', 'application/x-msdownload', 'application/x-msdos-program',
        'application/x-executable', 'application/x-mach-binary', 'application/x-elf',
        'application/x-sh', 'application/x-shellscript', 'text/x-shellscript',
        'application/hta', 'application/x-ms-shortcut',
    ];

    /** Categories we can safely preview inline. SVG is excluded (script risk). */
    private const PREVIEWABLE = ['pdf', 'image', 'video', 'audio', 'text'];

    public static function extensionOf(string $filename): string
    {
        if (! preg_match('/\.([A-Za-z0-9]+)$/', $filename, $m)) {
            return '';
        }

        return strtolower($m[1]);
    }

    public static function category(string $ext): string
    {
        return self::MAP[strtolower($ext)][0] ?? 'other';
    }

    public static function icon(string $ext): string
    {
        return self::MAP[strtolower($ext)][1] ?? 'File';
    }

    public static function isExtensionBlocked(string $ext): bool
    {
        return $ext !== '' && in_array(strtolower($ext), self::BLOCKED_EXT, true);
    }

    public static function isPreviewable(string $ext): bool
    {
        $ext = strtolower($ext);

        if ($ext === 'svg') {
            return false;
        }

        return in_array(self::category($ext), self::PREVIEWABLE, true);
    }

    /** Sniff the real MIME type from the file's bytes (never the name). */
    public static function sniff(string $absolutePath): string
    {
        // finfo frees itself when the object goes out of scope (finfo_close is
        // deprecated in PHP 8.5), so we don't close it explicitly.
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = $finfo ? finfo_file($finfo, $absolutePath) : null;

        return $mime ?: 'application/octet-stream';
    }

    /**
     * Validate an assembled/uploaded file on disk. Throws
     * FileValidationException with a specific, human message on rejection.
     * Returns [extension, mime, category, icon, previewable, size].
     */
    public static function inspect(string $absolutePath, string $originalName): array
    {
        if (! is_file($absolutePath)) {
            throw new FileValidationException('The uploaded file could not be found on the server.');
        }

        $size = filesize($absolutePath) ?: 0;
        if ($size > self::MAX_BYTES) {
            throw new FileValidationException('File exceeds the 2 GB limit.');
        }

        $ext = self::extensionOf($originalName);

        if ($ext !== '' && in_array($ext, self::BLOCKED_EXT, true)) {
            throw new FileValidationException('That file type is not allowed for security reasons.');
        }

        $mime = self::sniff($absolutePath);

        if (in_array(strtolower($mime), self::BLOCKED_MIME, true)) {
            throw new FileValidationException('That file appears to be an executable or script, which is not allowed.');
        }

        // Spoofing guard: a file claiming to be an image/document but whose
        // bytes are an executable/script is rejected.
        if (self::category($ext) === 'image' && ! self::mimeLooksLikeImage($mime)) {
            if (str_contains($mime, 'executable') || str_contains($mime, 'x-sh') || str_contains($mime, 'php')) {
                throw new FileValidationException('That file’s contents do not match its ‘.'.$ext.'’ extension.');
            }
        }

        return [
            'extension' => $ext,
            'mime' => $mime,
            'category' => self::category($ext),
            'icon' => self::icon($ext),
            'previewable' => self::isPreviewable($ext),
            'size' => $size,
        ];
    }

    private static function mimeLooksLikeImage(string $mime): bool
    {
        return str_starts_with(strtolower($mime), 'image/');
    }
}
