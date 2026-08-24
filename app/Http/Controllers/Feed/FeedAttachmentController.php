<?php

namespace App\Http\Controllers\Feed;

use App\Http\Controllers\Controller;
use App\Models\FeedAttachment;
use App\Support\Access\Role;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedAttachmentIntake;
use App\Support\Feed\FeedPresenter;
use App\Support\Files\FileValidationException;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Uploading and serving post/comment attachments (§18).
 *
 * Files are staged before the post exists so the composer can preview and
 * remove them while it is still being written, then claimed on save. Bytes are
 * never public: both download routes re-check channel access on every request.
 */
class FeedAttachmentController extends Controller
{
    /** Stage one file against a channel, ahead of the post that will own it. */
    public function store(Request $request, string $channelUuid): JsonResponse
    {
        $user = $request->user();
        $channel = FeedChannelController::resolve($request, $channelUuid);

        abort_unless(FeedAccess::canPost($channel, $user), 403, 'You cannot post in this channel.');

        $request->validate(['file' => ['required', 'file']]);

        try {
            $attachment = FeedAttachmentIntake::stage($request->file('file'), $channel, $user);
        } catch (FileValidationException $e) {
            // The intake's messages are written for the person uploading, so
            // they are surfaced as a field error rather than a 500.
            throw ValidationException::withMessages(['file' => $e->getMessage()]);
        }

        return response()->json([
            'attachment' => FeedPresenter::attachment($attachment),
        ], 201);
    }

    /**
     * Discard a staged file before its post is saved.
     *
     * Only the uploader, and only while it is still staged, once a post owns
     * it, removing it means editing the post.
     */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $attachment = FeedAttachment::query()
            ->where('uuid', $uuid)
            ->where('uploaded_by', $user->id)
            ->where('status', FeedAttachment::STATUS_STAGED)
            ->first();

        abort_unless($attachment, 404);

        try {
            Storage::disk($attachment->disk)->delete(array_filter([
                $attachment->path,
                $attachment->thumb_path,
            ]));
        } catch (\Throwable) {
            // The row goes either way; orphaned bytes are the prune's problem.
        }

        $attachment->forceDelete();

        return response()->json(['deleted' => true]);
    }

    /** Download or preview an attachment. */
    public function show(Request $request, string $uuid): StreamedResponse
    {
        $attachment = $this->attachmentFor($request, $uuid);

        $disk = Storage::disk($attachment->disk ?: Vault::diskName());
        abort_unless($disk->exists($attachment->path), 404);

        // Images and video are shown in place; everything else downloads.
        // A document is never rendered inline, an HTML file served inline
        // from the portal's own origin would run as the portal.
        $inline = $attachment->isImage() || $attachment->isVideo() || $attachment->isAudio();

        return $disk->response(
            $attachment->path,
            $attachment->name,
            [
                'Content-Type' => $attachment->mime ?: 'application/octet-stream',
                'Content-Disposition' => ($inline ? 'inline' : 'attachment')
                    .'; filename="'.addslashes($attachment->name).'"',
                'Cache-Control' => 'private, max-age=3600',
                'X-Content-Type-Options' => 'nosniff',
            ],
        );
    }

    /** The generated poster for an image or video attachment. */
    public function thumb(Request $request, string $uuid): StreamedResponse
    {
        $attachment = $this->attachmentFor($request, $uuid);

        abort_unless($attachment->thumb_path, 404);

        $disk = Storage::disk($attachment->disk ?: Vault::diskName());
        abort_unless($disk->exists($attachment->thumb_path), 404);

        return $disk->response($attachment->thumb_path, null, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /**
     * Resolve an attachment the caller may read.
     *
     * Access follows the channel the attachment belongs to, re-checked here
     * rather than trusted from whoever handed out the URL. A staged file is
     * readable only by the person who uploaded it, since no post has taken
     * responsibility for it yet.
     */
    private function attachmentFor(Request $request, string $uuid): FeedAttachment
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $attachment = FeedAttachment::query()
            ->with(['channel.members' => fn ($q) => $q->where('user_id', $user->id)])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($attachment, 404);

        if ($attachment->status === FeedAttachment::STATUS_STAGED) {
            abort_unless($attachment->uploaded_by === $user->id, 404);

            return $attachment;
        }

        abort_unless($attachment->channel, 404);
        FeedAccess::authorizeView($attachment->channel, $user);

        return $attachment;
    }
}
