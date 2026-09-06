<?php

namespace App\Support\Security;

use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Firm-held envelope encryption for vault bytes and call recordings.
 *
 * New writes are ciphertext. Existing plaintext objects stay readable
 * (the header is how we tell them apart), so turning this on does not
 * rewrite the store or lock anyone out of files that pre-date it.
 *
 * This is not zero-knowledge: the portal decrypts with a key derived from
 * APP_KEY so staff can still open, virus-scan, e-sign, and sync files.
 */
final class Envelope
{
    public const MAGIC = 'TMAENC1';

    public const VERSION = 1;

    public const CHUNK = 65536;

    public static function enabled(): bool
    {
        return (bool) config('filesystems.envelope_encrypt', true);
    }

    public static function isWrapped(string $bytes): bool
    {
        return str_starts_with($bytes, self::MAGIC);
    }

    public static function pathIsWrapped(string $path): bool
    {
        if (! is_file($path)) {
            return false;
        }

        $handle = fopen($path, 'rb');
        if ($handle === false) {
            return false;
        }

        $head = fread($handle, strlen(self::MAGIC));
        fclose($handle);

        return $head === self::MAGIC;
    }

    public static function wrapBytes(string $plain): string
    {
        if (! self::enabled() || self::isWrapped($plain)) {
            return $plain;
        }

        $source = self::tempFile();
        $dest = self::tempFile();
        file_put_contents($source, $plain);
        try {
            self::wrapFile($source, $dest);

            return (string) file_get_contents($dest);
        } finally {
            @unlink($source);
            @unlink($dest);
        }
    }

    public static function unwrapBytes(string $stored): string
    {
        if (! self::isWrapped($stored)) {
            return $stored;
        }

        $source = self::tempFile();
        $dest = self::tempFile();
        file_put_contents($source, $stored);
        try {
            self::unwrapFile($source, $dest);

            return (string) file_get_contents($dest);
        } finally {
            @unlink($source);
            @unlink($dest);
        }
    }

    public static function wrapFile(string $source, string $dest): void
    {
        $in = fopen($source, 'rb');
        $out = fopen($dest, 'wb');
        if ($in === false || $out === false) {
            throw new \RuntimeException('Could not open a file for envelope encryption.');
        }

        try {
            fwrite($out, self::MAGIC.chr(self::VERSION));
            while (! feof($in)) {
                $chunk = fread($in, self::CHUNK);
                if ($chunk === false || $chunk === '') {
                    break;
                }
                fwrite($out, self::packChunk($chunk));
            }
        } finally {
            fclose($in);
            fclose($out);
        }
    }

    public static function unwrapFile(string $source, string $dest): void
    {
        $in = fopen($source, 'rb');
        $out = fopen($dest, 'wb');
        if ($in === false || $out === false) {
            throw new \RuntimeException('Could not open a file for envelope decryption.');
        }

        try {
            $magic = fread($in, strlen(self::MAGIC));
            $version = ord((string) fread($in, 1));
            if ($magic !== self::MAGIC || $version !== self::VERSION) {
                throw new \RuntimeException('That file is not a portal envelope.');
            }

            while (! feof($in)) {
                $lenBytes = fread($in, 4);
                if ($lenBytes === false || strlen($lenBytes) < 4) {
                    break;
                }
                $len = unpack('N', $lenBytes)[1];
                if ($len < 1 || $len > self::CHUNK) {
                    throw new \RuntimeException('Envelope chunk is corrupt.');
                }
                $iv = fread($in, 12);
                $tag = fread($in, 16);
                $cipher = fread($in, $len);
                if ($iv === false || $tag === false || $cipher === false
                    || strlen($iv) !== 12 || strlen($tag) !== 16 || strlen($cipher) !== $len) {
                    throw new \RuntimeException('Envelope chunk is truncated.');
                }
                $plain = openssl_decrypt($cipher, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
                if ($plain === false) {
                    throw new \RuntimeException('Envelope decryption failed.');
                }
                fwrite($out, $plain);
            }
        } finally {
            fclose($in);
            fclose($out);
        }
    }

    /**
     * A local path of plaintext bytes. Wrapped files are decrypted to a temp
     * path the caller must pass to {@see forgetPlaintextPath()} when done.
     */
    public static function plaintextPath(string $abs): string
    {
        if (! self::pathIsWrapped($abs)) {
            return $abs;
        }

        $dest = self::tempFile();
        self::unwrapFile($abs, $dest);

        return $dest;
    }

    public static function forgetPlaintextPath(string $original, string $maybeTemp): void
    {
        if ($maybeTemp !== $original && is_file($maybeTemp)) {
            @unlink($maybeTemp);
        }
    }

    /** Plaintext bytes from a disk object, wrapped or not. */
    public static function readDisk(Filesystem $disk, string $path): string
    {
        $bytes = $disk->get($path);

        return is_string($bytes) ? self::unwrapBytes($bytes) : '';
    }

    /** Decrypt a disk object to a local temp file (or copy if already plain). */
    public static function materializeDisk(Filesystem $disk, string $path): ?string
    {
        $in = $disk->readStream($path);
        if ($in === false || $in === null) {
            return null;
        }

        $raw = self::tempFile();
        $out = fopen($raw, 'wb');
        if ($out === false) {
            fclose($in);

            return null;
        }
        stream_copy_to_stream($in, $out);
        fclose($in);
        fclose($out);

        if (! self::pathIsWrapped($raw)) {
            return $raw;
        }

        $plain = self::tempFile();
        try {
            self::unwrapFile($raw, $plain);
        } finally {
            @unlink($raw);
        }

        return $plain;
    }

    private static function packChunk(string $plain): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false || strlen($tag) !== 16) {
            throw new \RuntimeException('Envelope encryption failed.');
        }

        return pack('N', strlen($plain)).$iv.$tag.$cipher;
    }

    private static function key(): string
    {
        $override = (string) config('filesystems.envelope_key', '');
        $secret = $override !== '' ? $override : (string) config('app.key');

        return hash('sha256', $secret.'|vault-envelope', true);
    }

    private static function tempFile(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'tmaenc');
        if ($path === false) {
            throw new \RuntimeException('Could not allocate a temp file for envelope encryption.');
        }

        return $path;
    }
}
