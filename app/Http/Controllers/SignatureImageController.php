<?php

namespace App\Http\Controllers;

use App\Support\Mail\SignatureImages;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves the pictures inside email signatures.
 *
 * Same arrangement as {@see AvatarController}: the bucket is private,
 * because the file manager keeps confidential documents in it, so the bytes
 * come through the app instead of a public URL. Any signed-in person may
 * view one — a signature is shown to whoever is reading the mail it is on,
 * and the composer previews colleagues' signatures.
 *
 * Recipients of a sent message never use this route. Outbound mail carries
 * the picture as a CID attachment; see {@see SignatureImages::inline()}.
 */
class SignatureImageController extends Controller
{
    public function show(Request $request, string $name): StreamedResponse
    {
        abort_unless(SignatureImages::isStoredName($name), 404);

        $disk = Storage::disk(config('filesystems.avatar_disk', 'local'));
        $path = SignatureImages::PREFIX.'/'.$name;

        abort_unless($disk->exists($path), 404);

        return response()->stream(function () use ($disk, $path) {
            $stream = $disk->readStream($path);

            if ($stream === false || $stream === null) {
                return;
            }

            while (! feof($stream)) {
                echo fread($stream, 8192);
                flush();
            }

            fclose($stream);
        }, 200, [
            'Content-Type' => SignatureImages::mimeFor($path),
            // A signature image is written once and never edited, so the
            // browser may keep it; private, because the bucket is.
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
