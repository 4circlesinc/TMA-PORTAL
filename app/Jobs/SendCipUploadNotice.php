<?php

namespace App\Jobs;

use App\Models\CipApplication;
use App\Models\User;
use App\Support\Cip\Notices;
use App\Support\Cip\UploadNotices;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** One sitting's provider uploads, announced once. See {@see UploadNotices}. */
class SendCipUploadNotice implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public string $key,
        public int $applicationId,
        public ?int $uploaderId,
        public ?string $visitor,
    ) {}

    public function handle(): void
    {
        $names = UploadNotices::take($this->key);
        $application = CipApplication::find($this->applicationId);

        if ($names === [] || $application === null) {
            return;
        }

        $uploader = $this->uploaderId ? User::find($this->uploaderId) : null;
        $who = $uploader?->name ?: (trim((string) $this->visitor) ?: 'The service provider');

        Notices::uploaded($application, $uploader, $who, $names);
    }
}
