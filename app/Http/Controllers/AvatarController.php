<?php

namespace App\Http\Controllers;

use App\Models\CipApplication;
use App\Support\Cip\ApplicantFace;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves profile photos through the app instead of a public bucket URL, so the
 * storage bucket can stay private (the file manager keeps confidential documents
 * in the same private bucket). Any signed-in user may view any avatar, that's
 * expected: colleagues and clients see each other in the portal.
 */
class AvatarController extends Controller
{
    /**
     * The same photo for an iPhone notification: the app's notification
     * service extension cannot sign in, so the push carries a signed,
     * expiring link (MessagePush) and the route checks the signature.
     */
    public function forPush(Request $request, string $name): StreamedResponse
    {
        return $this->show($request, $name);
    }

    /**
     * An applicant's initials as a picture, for a notification about their
     * file when they have no photo (ApplicantFace). Signed and expiring, like
     * the photo link, because the phone's extension cannot sign in.
     */
    public function applicantInitials(string $uuid): Response
    {
        $application = CipApplication::query()->where('uuid', $uuid)->firstOrFail();

        return response(ApplicantFace::initialsPng($application), 200, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    public function show(Request $request, string $name): StreamedResponse
    {
        // Only our own generated names (uuid.jpg). Blocks path traversal.
        abort_unless(preg_match('/^[a-f0-9-]{36}\.jpg$/', $name) === 1, 404);

        $disk = Storage::disk(config('filesystems.avatar_disk', 'local'));
        $path = 'avatars/'.$name;

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
            'Content-Type' => 'image/jpeg',
            // Avatars rarely change and are low-sensitivity; let the browser
            // cache per-user so lists don't re-fetch every photo each render.
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
