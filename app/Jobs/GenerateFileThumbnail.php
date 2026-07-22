<?php

namespace App\Jobs;

use App\Models\FileItem;
use App\Support\Files\Thumbnail;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Build a file's thumbnail off the request.
 *
 * `Thumbnail::ensure()` decodes and resizes the source image, and it used to run
 * only on the first request for `/files/{uuid}/thumb`. That put a full image
 * decode inside a user-facing request, so the first time a freshly uploaded
 * photo appeared in a listing its tile sat blank while the server worked — and
 * a grid of new uploads did it once per tile, which is the "images load
 * forever" symptom on the File Library.
 *
 * Dispatching this on upload means the file is usually already thumbnailed by
 * the time anybody looks at it. The synchronous path in ThumbnailController is
 * deliberately kept as a fallback: files uploaded before this existed, and any
 * run where the queue is not draining, still resolve — just more slowly.
 */
class GenerateFileThumbnail implements ShouldQueue
{
    use Queueable;

    /** Retry a couple of times: storage can be briefly unreachable. */
    public int $tries = 3;

    /** A thumbnail is worthless long after the fact; give up rather than pile up. */
    public int $timeout = 120;

    public function __construct(public int $fileId) {}

    public function handle(): void
    {
        $file = FileItem::find($this->fileId);

        // Deleted between upload and processing: nothing to do, and not a failure.
        if (! $file) {
            return;
        }

        if (Thumbnail::isSvg($file)) {
            Thumbnail::ensureSvg($file);

            return;
        }

        Thumbnail::ensure($file);
    }

    /**
     * A file that cannot be thumbnailed is a normal outcome, not an incident —
     * the listing falls back to a file-type icon. Swallowing it here keeps
     * failed_jobs meaningful.
     */
    public function failed(\Throwable $e): void
    {
        report($e);
    }
}
