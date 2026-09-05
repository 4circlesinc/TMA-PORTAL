<?php

namespace App\Console\Commands;

use App\Models\ConnectedAccount;
use App\Support\Mail\MailCorrespondents;
use Illuminate\Console\Command;

class MailCorrespondentsCommand extends Command
{
    protected $signature = 'mail:correspondents {--account= : Only this connected account id}';

    protected $description = 'Rebuild the compose address book (mail_correspondents) from the mirrored mailboxes';

    public function handle(): int
    {
        $accounts = ConnectedAccount::query()
            ->where('sync_email', true)
            ->when($this->option('account'), fn ($q, $id) => $q->whereKey($id))
            ->get();

        foreach ($accounts as $account) {
            $written = MailCorrespondents::rebuild($account);
            $this->line("account {$account->id} ({$account->email}): {$written} messages folded in");
        }

        return self::SUCCESS;
    }
}
