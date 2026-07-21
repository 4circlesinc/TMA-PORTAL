<?php

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\MessageAttachment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves the bytes behind a message attachment, and a group's photo.
 *
 * Attachments are never public. Each request re-resolves the attachment
 * through the requester's conversation membership, so a leaked URL is useless
 * to anyone outside the thread. The disk is read from the row, not from config,
 * so files written before a disk switch keep resolving (same rule as the Vault).
 */
class MessagingAttachmentController extends Controller
{
    public function show(Request $request, string $uuid): StreamedResponse
    {
        $attachment = $this->attachmentFor($request, $uuid);

        return $this->stream(
            $attachment->disk,
            $attachment->path,
            $attachment->name,
            $attachment->mime,
            // Images, audio and video play inline; anything else downloads.
            inline: $attachment->isImage() || $attachment->isAudio() || $attachment->isVideo(),
        );
    }

    public function thumb(Request $request, string $uuid): StreamedResponse
    {
        $attachment = $this->attachmentFor($request, $uuid);

        abort_unless($attachment->thumb_path, 404);

        return $this->stream(
            $attachment->disk,
            $attachment->thumb_path,
            'thumb-'.$attachment->name,
            'image/jpeg',
            inline: true,
        );
    }

    /** A group's photo, visible to its members. */
    public function conversationPhoto(Request $request, string $uuid): StreamedResponse
    {
        $conversation = Conversation::query()
            ->forUser($request->user())
            ->where('uuid', $uuid)
            ->firstOrFail();

        abort_unless($conversation->photo_path, 404);

        return $this->stream(
            $conversation->photo_disk ?: config('filesystems.files_disk', 'local'),
            $conversation->photo_path,
            'group.jpg',
            'image/jpeg',
            inline: true,
        );
    }

    /**
     * Resolve an attachment only through a conversation the requester is in.
     * A non-member gets a 404 - the same answer as a uuid that doesn't exist.
     */
    private function attachmentFor(Request $request, string $uuid): MessageAttachment
    {
        return MessageAttachment::query()
            ->whereHas('message.conversation', fn ($q) => $q->forUser($request->user()))
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    private function stream(
        string $disk,
        string $path,
        string $name,
        ?string $mime,
        bool $inline,
    ): StreamedResponse {
        $storage = Storage::disk($disk);

        abort_unless($storage->exists($path), 404);

        $disposition = $inline ? 'inline' : 'attachment';
        $safeName = str_replace('"', '', $name);

        return response()->stream(function () use ($storage, $path) {
            $handle = $storage->readStream($path);
            if ($handle === false || $handle === null) {
                return;
            }

            fpassthru($handle);
            fclose($handle);
        }, 200, [
            'Content-Type' => $mime ?: 'application/octet-stream',
            'Content-Length' => (string) $storage->size($path),
            'Content-Disposition' => $disposition.'; filename="'.$safeName.'"',
            // Attachments are private; keep them out of shared caches.
            'Cache-Control' => 'private, max-age=3600',
            // Never let a stored file be interpreted as something else.
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
