<?php

use App\Jobs\ResolveSenderPhoto;
use App\Models\ConnectedAccount;
use App\Models\MailSenderPhoto;
use App\Models\Notification;
use Illuminate\Database\Migrations\Migration;

/**
 * Org addresses were re-cached as brand favicons after the previous expire
 * pass (directory miss → Google favicon → 30-day HIT TTL). That blocked
 * real face retries and left notification avatars stuck on initials.
 *
 * Expire brand/non-face caches again (now with a shorter brand TTL and
 * same-org brand skip in MailSenderPhoto::resolve) and re-queue face
 * lookups for recent email notifications.
 */
return new class extends Migration
{
    public function up(): void
    {
        MailSenderPhoto::expireNonFaceCaches();

        // Same-org brand rows must not linger as "has_photo" faces.
        MailSenderPhoto::query()
            ->where('has_photo', true)
            ->where('source', 'brand')
            ->update([
                'has_photo' => false,
                'source' => null,
                'checked_at' => now()->subDays(8),
                'updated_at' => now(),
            ]);

        $emails = Notification::query()
            ->where('module', 'email')
            ->where('created_at', '>=', now()->subDays(21))
            ->orderByDesc('id')
            ->limit(300)
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
