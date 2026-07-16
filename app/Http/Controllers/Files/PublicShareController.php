<?php

namespace App\Http\Controllers\Files;

use App\Http\Controllers\Controller;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Support\Files\Activity;
use App\Support\Files\FileType;
use App\Support\Files\FolderTree;
use App\Support\Files\Sharing;
use App\Support\Files\Vault;
use Illuminate\Http\Request;

/**
 * Public share links (no login). Everything is keyed off the random token —
 * the storage path, disk, and database id are never exposed.
 */
class PublicShareController extends Controller
{
    public function show(Request $request, string $token)
    {
        $share = $this->activeLink($token);
        if (! $share) {
            return response()->view('share.expired', [], 404);
        }

        if ($share->password_hash && ! $this->unlocked($request, $token)) {
            return response()->view('share.password', ['token' => $token, 'error' => false]);
        }

        if ($share->item_type === 'file') {
            $file = FileItem::find($share->item_id);
            if (! $file) {
                return response()->view('share.expired', [], 404);
            }
            Activity::log(null, 'file', $file->id, 'preview', ['via' => 'link']);

            return response()->view('share.file', [
                'share' => $share,
                'file' => $file,
                'token' => $token,
                'category' => FileType::category((string) $file->extension),
                'previewable' => FileType::isPreviewable((string) $file->extension) || strtolower((string) $file->extension) === 'svg',
            ]);
        }

        $folder = Folder::find($share->item_id);
        if (! $folder) {
            return response()->view('share.expired', [], 404);
        }

        return response()->view('share.folder', [
            'share' => $share,
            'folder' => $folder,
            'token' => $token,
            'folders' => $folder->children()->orderBy('name')->get(),
            'files' => $folder->files()->orderBy('name')->get(),
        ]);
    }

    public function unlock(Request $request, string $token)
    {
        $share = $this->activeLink($token);
        if (! $share) {
            return response()->view('share.expired', [], 404);
        }

        if (! Sharing::verifyPassword($share, $request->input('password'))) {
            return response()->view('share.password', ['token' => $token, 'error' => true], 422);
        }

        $request->session()->put('share_unlocked.'.$token, true);

        return redirect('/s/'.$token);
    }

    public function preview(Request $request, string $token)
    {
        $share = $this->guardedFileShare($request, $token);
        $file = FileItem::find($share->item_id);
        abort_unless($file, 404);

        return Vault::preview($file);
    }

    public function download(Request $request, string $token)
    {
        $share = $this->activeLink($token);
        abort_unless($share, 404);
        abort_if($share->password_hash && ! $this->unlocked($request, $token), 403);
        abort_unless($share->allow_download, 403, 'Downloading is turned off for this link.');

        if ($share->item_type === 'file') {
            $file = FileItem::find($share->item_id);
            abort_unless($file, 404);
            Activity::log(null, 'file', $file->id, 'download', ['via' => 'link']);

            return Vault::download($file);
        }

        $folder = Folder::find($share->item_id);
        abort_unless($folder, 404);
        $zipPath = FolderTree::zip($folder);
        Activity::log(null, 'folder', $folder->id, 'download', ['via' => 'link', 'as' => 'zip']);

        return response()->streamDownload(function () use ($zipPath) {
            $stream = fopen($zipPath, 'rb');
            while ($stream && ! feof($stream)) {
                echo fread($stream, 8192);
                flush();
            }
            if ($stream) {
                fclose($stream);
            }
            @unlink($zipPath);
        }, $folder->name.'.zip', ['Content-Type' => 'application/zip', 'X-Content-Type-Options' => 'nosniff']);
    }

    /** Download one file that lives inside a shared folder's subtree. */
    public function file(Request $request, string $token, string $fileUuid)
    {
        $share = $this->activeLink($token);
        abort_unless($share && $share->item_type === 'folder', 404);
        abort_if($share->password_hash && ! $this->unlocked($request, $token), 403);
        abort_unless($share->allow_download, 403, 'Downloading is turned off for this link.');

        $folder = Folder::find($share->item_id);
        abort_unless($folder, 404);
        $file = FileItem::where('uuid', $fileUuid)->first();
        abort_unless($file, 404);

        $allowed = array_merge([$folder->id], FolderTree::descendantIds($folder));
        abort_unless(in_array($file->folder_id, $allowed, true), 403);

        Activity::log(null, 'file', $file->id, 'download', ['via' => 'link']);

        return Vault::download($file);
    }

    private function guardedFileShare(Request $request, string $token): Share
    {
        $share = $this->activeLink($token);
        abort_unless($share && $share->item_type === 'file', 404);
        abort_if($share->password_hash && ! $this->unlocked($request, $token), 403);

        return $share;
    }

    private function activeLink(string $token): ?Share
    {
        $share = Share::where('token', $token)->where('kind', 'link')->first();

        return $share && $share->isActive() ? $share : null;
    }

    private function unlocked(Request $request, string $token): bool
    {
        return (bool) $request->session()->get('share_unlocked.'.$token);
    }
}
