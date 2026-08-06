<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\Branding;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Settings → Account and Reporting → Edit Company Branding.
 *
 * Reading branding is open to every signed-in account — the whole point is
 * that the firm's name, title and colours reach everybody's browser. Editing
 * it needs `settings.branding`, which is administrators only.
 */
class BrandingController extends Controller
{
    /** Logos are chrome, not documents: a couple of megabytes is plenty. */
    private const MAX_KILOBYTES = 2048;

    public function show(): JsonResponse
    {
        return response()->json(['branding' => Branding::get()]);
    }

    public function update(Request $request): JsonResponse
    {
        $this->authorizeBranding($request);

        $data = $request->validate([
            'accountName' => ['required', 'string', 'max:120'],
            'pageTitle' => ['nullable', 'string', 'max:160'],
            // Hex only. The colours are written straight into a style
            // attribute by the browser, so anything else is an injection.
            'headerColor' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'accentColor' => ['nullable', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
        ]);

        return response()->json([
            'branding' => Branding::put([
                'accountName' => trim($data['accountName']),
                'pageTitle' => trim((string) ($data['pageTitle'] ?? '')) ?: null,
                'headerColor' => $data['headerColor'] ?? Branding::DEFAULTS['headerColor'],
                'accentColor' => $data['accentColor'] ?? Branding::DEFAULTS['accentColor'],
            ], $request->user()->id),
        ]);
    }

    public function uploadLogo(Request $request): JsonResponse
    {
        $this->authorizeBranding($request);

        // No SVG: it is a script container, and this file is streamed back to
        // every account's browser as page chrome.
        $request->validate([
            'logo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:'.self::MAX_KILOBYTES],
        ]);

        $file = $request->file('logo');
        $extension = mb_strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $path = Branding::LOGO_DIRECTORY.'/'.Str::uuid()->toString().'.'.$extension;

        // No visibility argument: the bucket is shared with the file manager
        // and stays private. The logo is served back through show()/logo().
        Storage::disk(Branding::disk())->put($path, $file->get());

        Branding::deleteLogo(Branding::get()['logo'] ?? null);

        return response()->json([
            'branding' => Branding::put([
                'logo' => '/media/'.$path,
                'logoName' => $file->getClientOriginalName(),
            ], $request->user()->id),
        ]);
    }

    public function destroyLogo(Request $request): JsonResponse
    {
        $this->authorizeBranding($request);

        Branding::deleteLogo(Branding::get()['logo'] ?? null);

        return response()->json([
            'branding' => Branding::put(['logo' => null, 'logoName' => null], $request->user()->id),
        ]);
    }

    /** "Use Portal Defaults" — appearance only; the account name is kept. */
    public function reset(Request $request): JsonResponse
    {
        $this->authorizeBranding($request);

        return response()->json(['branding' => Branding::reset($request->user()->id)]);
    }

    /** Streams the stored logo, the way AvatarController streams photos. */
    public function logo(string $name): StreamedResponse
    {
        // Only names we generated ourselves. Blocks path traversal.
        abort_unless(preg_match('/^[a-f0-9-]{36}\.[a-z]{3,4}$/', $name) === 1, 404);

        $disk = Storage::disk(Branding::disk());
        $path = Branding::LOGO_DIRECTORY.'/'.$name;

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
            'Content-Type' => $disk->mimeType($path) ?: 'image/png',
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function authorizeBranding(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'settings.branding'), 403);
    }
}
