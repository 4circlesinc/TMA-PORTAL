<?php

namespace App\Http\Controllers\Files;

use App\Support\Files\FileAccess;
use App\Support\Files\Thumbnail;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ThumbnailController extends BaseFilesController
{
    /** A small cached image thumbnail; 404 when the file can't be thumbnailed. */
    public function show(Request $request, string $uuid): BinaryFileResponse
    {
        $file = $this->findFile($uuid);
        FileAccess::authorize($this->user($request), 'view', $file);

        if (Thumbnail::isSvg($file)) {
            $path = Thumbnail::ensureSvg($file);
            abort_unless($path, 404, 'No thumbnail available.');
            $response = response()->file($path, [
                'Content-Type' => 'image/svg+xml',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        } else {
            $path = Thumbnail::ensure($file);
            abort_unless($path, 404, 'No thumbnail available.');
            $response = response()->file($path, [
                'Content-Type' => 'image/jpeg',
                'X-Content-Type-Options' => 'nosniff',
            ]);
        }

        $response->setPrivate();
        $response->setMaxAge(3600);

        return $response;
    }
}
