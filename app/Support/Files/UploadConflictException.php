<?php

namespace App\Support\Files;

use RuntimeException;

/**
 * Raised by complete() when a file of the same name already exists in the
 * target and the client hasn't yet chosen how to resolve it. Surfaced as a 409
 * so the UI can offer Replace / Keep both / Rename / Cancel — never a silent
 * overwrite. The upload's chunks stay intact so the retry doesn't re-upload.
 */
class UploadConflictException extends RuntimeException
{
    public function __construct(public string $existingName, public string $suggestion)
    {
        parent::__construct('A file named “'.$existingName.'” already exists here.');
    }
}
