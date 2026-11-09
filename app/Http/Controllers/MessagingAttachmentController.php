<?php

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\MessageAttachment;
use App\Models\Folder;
use App\Support\Files\FileAccess;
use App\Support\Files\FileValidationException;
use App\Support\Files\SaveToFolder;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves the bytes behind a message attachment, and a group's photo.
 *
 * Attachments are never public. Each request re-resolves the attachment
 * through the requester's conversation membership, so a leaked URL is useless
 * to anyone outside the thread. The disk is read from the row, not from config,
 * so files written before a disk switch keep resolving (same rule as the Vault).
 *
 * The bytes go out through the Vault, which wrote them: new uploads are
 * envelope-encrypted at rest, and only it knows how to open one.
 */
class MessagingAttachmentController extends Controller
{
    public function show(Request $request, string $uuid): Response
    {
        $attachment = $this->attachmentFor($request, $uuid);

        return $this->stream(
            $attachment->disk,
            $attachment->path,
            $attachment->name,
            $attachment->mime,
            // Images, audio and video play inline; anything else downloads.
            // ?download=1 is the Download action: a photo or a video saved
            // to the computer, not opened in a tab.
            inline: ! $request->boolean('download')
                && ($attachment->isImage() || $attachment->isAudio() || $attachment->isVideo()),
        );
    }

    /**
     * Save a copy of this attachment into a folder of the document library,
     * without a round trip through the reader's computer.
     */
    public function save(Request $request, string $uuid): JsonResponse
    {
        $attachment = $this->attachmentFor($request, $uuid);
        abort_if($attachment->trashed(), 404);

        $data = $request->validate(['folderId' => ['required', 'string', 'max:64']]);
        $folder = Folder::query()->where('uuid', $data['folderId'])->firstOrFail();

        $scratch = Vault::scratchCopyOf($attachment->disk, (string) $attachment->path, (string) ($attachment->extension ?? ''));
        abort_if($scratch === null, 410, 'This attachment is no longer available.');

        try {
            $file = SaveToFolder::fromPath($request->user(), $folder, $scratch, (string) $attachment->name, 'messaging');
        } catch (FileValidationException $e) {
            abort(422, $e->getMessage());
        } finally {
            Vault::cleanupLocalCopy($scratch);
        }

        return response()->json([
            'file' => ['id' => $file->uuid, 'name' => $file->name],
            'folder' => ['id' => $folder->uuid, 'name' => $folder->name],
        ], 201);
    }

    public function thumb(Request $request, string $uuid): Response
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
    /**
     * A group's photo for an iPhone message notification (MessagePush): the
     * app's notification service extension cannot sign in, so the push
     * carries a signed, expiring link to this.
     */
    public function conversationPhotoForPush(string $uuid): Response
    {
        $conversation = Conversation::query()->where('uuid', $uuid)->firstOrFail();
        abort_unless($conversation->photo_path, 404);

        return $this->stream(
            $conversation->photo_disk ?: config('filesystems.files_disk', 'local'),
            $conversation->photo_path,
            'group.jpg',
            'image/jpeg',
            inline: true,
        );
    }

    public function conversationPhoto(Request $request, string $uuid): Response
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
        $user = $request->user();

        // Administrators may resolve soft-deleted attachments for Recycle Bin previews.
        if (FileAccess::isAdmin($user)) {
            $trashed = MessageAttachment::onlyTrashed()->where('uuid', $uuid)->first();
            if ($trashed) {
                return $trashed;
            }
        }

        return MessageAttachment::query()
            ->where(function ($q) use ($user) {
                $q->whereHas('message.conversation', fn ($c) => $c->forUser($user))
                    ->orWhere(function ($staged) use ($user) {
                        $staged->whereNull('message_id')
                            ->where('uploaded_by', $user->id)
                            ->whereHas('conversation', fn ($c) => $c->forUser($user));
                    });
            })
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    private function stream(
        string $disk,
        string $path,
        string $name,
        ?string $mime,
        bool $inline,
    ): Response {
        return Vault::serve($disk, $path, str_replace('"', '', $name), $mime, $inline ? 'inline' : 'attachment');
    }
}
