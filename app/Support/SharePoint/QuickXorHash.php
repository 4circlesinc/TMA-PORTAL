<?php

namespace App\Support\SharePoint;

/**
 * Microsoft's QuickXorHash, the content hash Graph reports for every
 * OneDrive/SharePoint file (`file.hashes.quickXorHash`).
 *
 * A 160-bit register; each input byte is XORed in at a position that
 * advances 11 bits per byte (mod 160), and the total length is XORed into
 * the final 8 bytes. Validated byte-for-byte against a live Graph item
 * (2026-09-02): computed and reported hashes matched exactly.
 *
 * Why it exists here: comparing this against our own stored bytes is how a
 * push tells a REAL divergence from a phantom one — an upload that "failed"
 * with a gateway timeout but actually landed bumps SharePoint's cTag with
 * our own content, and without the hash that read as somebody else's edit.
 */
class QuickXorHash
{
    private const WIDTH_BYTES = 20;

    private const SHIFT = 11;

    /** @var array<int, int> */
    private array $bits;

    private int $length = 0;

    public function __construct()
    {
        $this->bits = array_fill(0, self::WIDTH_BYTES, 0);
    }

    /** Feed bytes; call as many times as the stream needs. */
    public function update(string $chunk): void
    {
        $len = strlen($chunk);

        for ($i = 0; $i < $len; $i++) {
            $shift = (($this->length + $i) * self::SHIFT) % (self::WIDTH_BYTES * 8);
            $bytePos = intdiv($shift, 8);
            $bitPos = $shift % 8;
            $b = ord($chunk[$i]);

            $this->bits[$bytePos] ^= ($b << $bitPos) & 0xFF;
            if ($bitPos !== 0) {
                $this->bits[($bytePos + 1) % self::WIDTH_BYTES] ^= ($b >> (8 - $bitPos)) & 0xFF;
            }
        }

        $this->length += $len;
    }

    /** The finished hash, base64 the way Graph reports it. */
    public function base64(): string
    {
        $bits = $this->bits;

        // The total length, little-endian, XORed into the last 8 bytes.
        $lengthBytes = pack('P', $this->length);
        for ($i = 0; $i < 8; $i++) {
            $bits[self::WIDTH_BYTES - 8 + $i] ^= ord($lengthBytes[$i]);
        }

        return base64_encode(pack('C*', ...$bits));
    }

    /**
     * Hash a stream in chunks, or null when it cannot be read. Chunked so a
     * large document never has to fit in worker memory.
     *
     * @param  resource  $stream
     */
    public static function ofStream($stream): ?string
    {
        $hasher = new self;

        while (! feof($stream)) {
            $chunk = fread($stream, 1024 * 1024);
            if ($chunk === false) {
                return null;
            }
            $hasher->update($chunk);
        }

        return $hasher->base64();
    }
}
