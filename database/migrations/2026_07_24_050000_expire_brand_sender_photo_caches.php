<?php

use App\Jobs\ResolveSenderPhoto;
use App\Models\ConnectedAccount;
use App\Models\MailSenderPhoto;
use App\Models\Notification;
use Illuminate\Database\Migrations\Migration;

/**
 * Brand favicons were cached as sender "photos" for many people (especially
 * org addresses that fell through to Google's favicon). Notification avatars
 * correctly refuse those now, but the fresh TTL blocks a directory re-fetch.
 * Expire the bad caches and re-queue photo resolves for recent email notifs.
 */
return new class extends Migration
{
    public function up(): void
    {
        MailSenderPhoto::expireNonFaceCaches();

        $emails = Notification::query()
            ->where('module', 'email')
            ->where('created_at', '>=', now()->subDays(14))
            ->orderByDesc('id')
            ->limit(200)
            ->get(['user_id', 'metadata'])
            ->map(function (Notification $n) {
                $email = mb_strtolower((string) data_get($n->metadata, 'from_email', ''));

                return $email !== '' && str_contains($email, '@')
                    ? ['user_id' => $n->user_id, 'email' => $email]
                    : null;
            })
            ->filter()
            ->unique(fn (array $row) => $row['user_id'].'|'.$row['email'])
            ->values();

        $accounts = ConnectedAccount::query()
            ->whereIn('user_id', $emails->pluck('user_id')->unique()->all())
            ->whereNotNull('token')
            ->whereIn('provider', ['microsoft', 'google'])
            ->orderByDesc('updated_at')
            ->get()
            ->groupBy('user_id');

        foreach ($emails as $row) {
            $account = $accounts->get($row['user_id'])?->first();
            if (! $account) {
                continue;
            }
            ResolveSenderPhoto::dispatch($account, $row['email']);
        }
    }

    public function down(): void
    {
        // Irreversible cache refresh.
    }
};
