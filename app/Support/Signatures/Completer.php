<?php

namespace App\Support\Signatures;

use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Support\Files\Activity as FileActivity;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Finishes a fully-signed request: stamps the document and files the signed
 * copy in the library beside the original.
 *
 * The original is never modified or replaced - the two are separate rows in
 * `files`, so "what we sent" and "what came back signed" both survive.
 */
class Completer
{
    /**
     * Produce and store the signed copy.
     *
     * Returns the new file, or null when stamping failed. Failure is not fatal:
     * the signatures are already recorded, so the request stays completed and
     * the copy can be regenerated once the cause is fixed.
     */
    public static function finalize(SignatureRequest $request): ?FileItem
    {
        if ($request->signed_file_id) {
            return $request->signedFile; // already done; never stamp twice
        }

        $original = $request->file;
        if (! $original) {
            return null;
        }

        try {
            $stampedPath = Stamper::stamp($request);
        } catch (StampingException $e) {
            // Loud in the log, quiet for the user: they signed successfully.
            Log::error('Signature stamping failed', [
                'request' => $request->uuid,
                'file' => $original->uuid,
                'error' => $e->getMessage(),
            ]);
            Activity::log($request, Activity::COMPLETED, null, [
                'stamped' => false,
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        // Vault::store consumes the temp file.
        $stored = Vault::store($stampedPath, 'pdf');

        $signed = DB::transaction(function () use ($request, $original, $stored) {
            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                // Where the sender chose, falling back to beside the original.
                'folder_id' => $request->folder_id ?? $original->folder_id,
                'name' => self::signedName($request, $original),
                'extension' => 'pdf',
                'mime_type' => 'application/pdf',
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => $original->owner_id,
                'uploaded_by' => $request->created_by,
            ]);

            $request->forceFill(['signed_file_id' => $file->id])->save();

            return $file;
        });

        // Show up in the library's own activity feed too, not just ours.
        FileActivity::forFile($request->created_by, $signed, 'upload', [
            'via' => 'signature',
            'request' => $request->uuid,
        ]);

        return $signed;
    }

    /**
     * "Contract.pdf" -> "Contract (signed).pdf", de-duplicated in its folder
     * so a second request against the same document doesn't collide.
     */
    private static function signedName(SignatureRequest $request, FileItem $original): string
    {
        $base = preg_replace('/\.[^.]+$/', '', $request->title ?: $original->name);
        $name = Naming::assertValid($base.' (signed).pdf');
        $folderId = $request->folder_id ?? $original->folder_id;

        return Naming::nextAvailable($name, fn (string $candidate) => FileItem::query()
            ->where('owner_id', $original->owner_id)
            ->where('folder_id', $folderId)
            ->where('name', $candidate)
            ->exists());
    }
}
