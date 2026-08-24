<?php

namespace App\Http\Controllers\Files;

use App\Support\Files\FileAccess;
use App\Support\Files\Thumbnail;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

class ThumbnailController extends BaseFilesController
{
    private const CACHE_CONTROL = 'private, max-age=86400, must-revalidate';

    /** A small cached image thumbnail; 404 when the file can't be thumbnailed. */
    public function show(Request $request, string $uuid): SymfonyResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        if ($file->trashed()) {
            abort_unless(FileAccess::isAdmin($user), 403, 'Permission denied.');
        } else {
            FileAccess::authorize($user, 'view', $file);
        }

        $svg = Thumbnail::isSvg($file);
        $etag = Thumbnail::entityTag($file, $svg ? 'svg' : 'jpg');

        /*
         * A folder of thirty photos asks for thirty of these on every visit,
         * and a thumbnail only changes when the file behind it does. Answering
         * the repeat visit here, before Thumbnail::ensure, which on a cold
         * container means pulling each original out of R2, is most of why a
         * grid now paints at once.
         */
        if ($request->headers->get('If-None-Match') === $etag) {
            return response('', 304, [
                'ETag' => $etag,
                'Cache-Control' => self::CACHE_CONTROL,
            ])->setPrivate();
        }

        $path = $svg ? Thumbnail::ensureSvg($file) : Thumbnail::ensure($file);
        abort_unless($path, 404, 'No thumbnail available.');

        $response = response()->file($path, [
            'Content-Type' => $svg ? 'image/svg+xml' : 'image/jpeg',
            'X-Content-Type-Options' => 'nosniff',
            'ETag' => $etag,
            'Cache-Control' => self::CACHE_CONTROL,
        ]);
        $response->setPrivate();

        return $response;
    }
}
