<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Support\Mail\MailCorrespondents;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Rebuilds one mailbox's compose address book from the mirrored messages.
 *
 * Mailboxes that were synced before mail_correspondents existed have the
 * history already stored locally; this folds it into the indexed table so
 * the typeahead can answer without scanning mail_messages on every keystroke.
 */
class BackfillMailCorrespondents implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 600;

    public function __construct(
        public ConnectedAccount $account,
    ) {}

    /** @return array<int, object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('mail-correspondents:'.$this->account->id))->dontRelease()->expireAfter(660)];
    }

    public function handle(): void
    {
        MailCorrespondents::rebuild($this->account);
    }
}
