<?php

namespace App\Support\Mail;

use Illuminate\Validation\ValidationException;

/**
 * File attachments on an outgoing compose, decoded from the JSON the
 * composer posts (name + mime + base64). Inline signature images stay
 * in {@see InlineImages}; these are the paperclip / drag-and-drop files.
 */
final class OutboundFiles
{
    public const MAX_COUNT = 10;

    public const MAX_BYTES = 10 * 1024 * 1024;

    /**
     * @return list<array{name: string, mime: string, bytes: string}>
     */
    public static function fromRequest(mixed $items): array
    {
        if ($items === null || $items === []) {
            return [];
        }
        if (! is_array($items)) {
            throw ValidationException::withMessages([
                'attachments' => 'Attachments must be a list of files.',
            ]);
        }
        if (count($items) > self::MAX_COUNT) {
            throw ValidationException::withMessages([
                'attachments' => 'Up to '.self::MAX_COUNT.' files can be attached.',
            ]);
        }

        $out = [];
        foreach ($items as $index => $item) {
            if (! is_array($item)) {
                continue;
            }
            $name = self::safeFilename((string) ($item['name'] ?? ''));
            $raw = preg_replace('/\s+/', '', (string) ($item['content'] ?? '')) ?? '';
            $bytes = $raw !== '' ? base64_decode($raw, true) : false;
            if ($bytes === false || $bytes === '') {
                throw ValidationException::withMessages([
                    "attachments.$index.content" => 'This file could not be read.',
                ]);
            }
            if (strlen($bytes) > self::MAX_BYTES) {
                throw ValidationException::withMessages([
                    "attachments.$index" => $name.' is over 10 MB.',
                ]);
            }
            $mime = trim((string) ($item['mime'] ?? ''));
            if ($mime === '' || ! str_contains($mime, '/')) {
                $mime = 'application/octet-stream';
            }

            $out[] = [
                'name' => $name,
                'mime' => $mime,
                'bytes' => $bytes,
            ];
        }

        return $out;
    }

    public static function safeFilename(string $name): string
    {
        $name = str_replace(['"', "\r", "\n", '/', '\\'], '', basename(trim($name)));

        return $name !== '' ? mb_substr($name, 0, 255) : 'attachment';
    }
}
