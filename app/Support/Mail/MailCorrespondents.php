<?php

namespace App\Support\Mail;

use App\Jobs\BackfillMailCorrespondents;
use App\Models\ConnectedAccount;
use App\Models\MailCorrespondent;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * The address book a mailbox writes for itself.
 *
 * Every message the sync stores adds its sender and its To / Cc / Bcc
 * addresses here, so the compose typeahead can offer anyone the user has
 * ever exchanged mail with — not only the newest two hundred messages'
 * worth — from one indexed table rather than a scan. A mailbox synced
 * before this table existed is rebuilt from the mirror once, in the
 * background, the first time its owner opens compose.
 */
final class MailCorrespondents
{
    private const REBUILD_CHUNK = 500;

    private const WARM_LIMIT = 500;

    /**
     * Fold a batch of messages into the table. Accepts the normalized
     * provider arrays the sync works with and MailMessage rows alike.
     *
     * @param  iterable<int, array<string, mixed>|MailMessage>  $messages
     */
    public static function record(ConnectedAccount $account, iterable $messages): void
    {
        $own = mb_strtolower(trim((string) $account->email));
        $seen = [];

        foreach ($messages as $message) {
            self::foldInto($seen, $message);
        }

        unset($seen[$own]);
        if ($seen === []) {
            return;
        }

        $existing = MailCorrespondent::query()
            ->where('user_id', $account->user_id)
            ->whereIn('email', array_keys($seen))
            ->get()
            ->keyBy('email');

        $now = now();
        $rows = [];

        foreach ($seen as $email => $tally) {
            /** @var MailCorrespondent|null $row */
            $row = $existing->get($email);
            $last = $row?->last_seen_at;
            if ($tally['last'] && (! $last || $tally['last']->greaterThan($last))) {
                $last = $tally['last'];
            }

            $rows[] = [
                'user_id' => $account->user_id,
                'email' => $email,
                // The name the address carried most recently; an older one is
                // kept only when the new mail carried none.
                'name' => $tally['name'] !== '' ? mb_substr($tally['name'], 0, 255) : $row?->name,
                'count' => (int) ($row?->count ?? 0) + $tally['count'],
                'last_seen_at' => $last,
                'created_at' => $row?->created_at ?? $now,
                'updated_at' => $now,
            ];
        }

        MailCorrespondent::upsert($rows, ['user_id', 'email'], ['name', 'count', 'last_seen_at', 'updated_at']);
    }

    /**
     * Rebuild from the mirror with absolute counts so a mailbox synced
     * before this table existed still has every sender and recipient.
     *
     * Existing typeahead rows stay in place until the new counts land, so
     * compose does not go empty mid-rebuild.
     */
    public static function rebuild(ConnectedAccount $account): int
    {
        $own = mb_strtolower(trim((string) $account->email));
        $seen = [];
        $written = 0;

        MailMessage::query()
            ->where('user_id', $account->user_id)
            ->select(['id', 'from_name', 'from_email', 'to', 'cc', 'bcc', 'sent_at'])
            ->orderBy('id')
            ->chunkById(self::REBUILD_CHUNK, function (Collection $rows) use (&$seen, &$written) {
                foreach ($rows as $message) {
                    self::foldInto($seen, $message);
                }
                $written += $rows->count();
            });

        unset($seen[$own]);

        $now = now();
        foreach (array_chunk($seen, 200, true) as $chunk) {
            $rows = [];
            foreach ($chunk as $email => $tally) {
                $rows[] = [
                    'user_id' => $account->user_id,
                    'email' => $email,
                    'name' => $tally['name'] !== '' ? mb_substr($tally['name'], 0, 255) : null,
                    'count' => $tally['count'],
                    'last_seen_at' => $tally['last'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            MailCorrespondent::upsert($rows, ['user_id', 'email'], ['name', 'count', 'last_seen_at', 'updated_at']);
        }

        $keep = array_keys($seen);
        $stale = MailCorrespondent::query()->where('user_id', $account->user_id);
        if ($keep === []) {
            $stale->delete();
        } else {
            $stale->whereNotIn('email', $keep)->delete();
        }

        return $written;
    }

    /** Recent mail, folded in on the request that first opens compose. */
    public static function warmFromMirror(ConnectedAccount $account, int $limit = self::WARM_LIMIT): void
    {
        $rows = MailMessage::query()
            ->where('user_id', $account->user_id)
            ->orderByDesc('sent_at')
            ->limit($limit)
            ->get(['from_name', 'from_email', 'to', 'cc', 'bcc', 'sent_at']);

        if ($rows->isEmpty()) {
            return;
        }

        self::record($account, $rows);
    }

    public static function hasAny(User $user): bool
    {
        return MailCorrespondent::query()->where('user_id', $user->id)->exists();
    }

    /** Queue the one-off rebuild for a mailbox synced before the table existed. */
    public static function ensureBuilt(User $user, ?ConnectedAccount $account): void
    {
        if (! $account) {
            return;
        }

        if (! self::hasAny($user)) {
            self::warmFromMirror($account);
        }

        if (Cache::add('mail-correspondents-backfill:'.$account->id, 1, now()->addDays(30))) {
            BackfillMailCorrespondents::dispatch($account)->afterResponse();
        }
    }

    /**
     * The typeahead's read: addresses matching the term (or the most used
     * ones for an empty term), busiest and most recent first.
     *
     * @return Collection<int, MailCorrespondent>
     */
    public static function search(User $user, string $term, int $limit): Collection
    {
        $term = mb_strtolower(trim($term));

        return MailCorrespondent::query()
            ->where('user_id', $user->id)
            ->when($term !== '', function ($q) use ($term) {
                $needle = '%'.addcslashes($term, '%_\\').'%';
                $q->where(function ($w) use ($needle) {
                    $w->whereRaw("lower(email) like ? escape '\\'", [$needle])
                        ->orWhereRaw("lower(coalesce(name, '')) like ? escape '\\'", [$needle]);
                });
            })
            ->orderByDesc('count')
            ->orderByDesc('last_seen_at')
            ->limit($limit)
            ->get();
    }

    /**
     * @param  array<string, array{name: string, count: int, last: ?Carbon}>  $seen
     * @param  array<string, mixed>|MailMessage  $message
     */
    private static function foldInto(array &$seen, mixed $message): void
    {
        $m = $message instanceof MailMessage ? $message->toArray() : (array) $message;
        $at = self::instant($m['sent_at'] ?? null);

        self::tally($seen, $m['from_email'] ?? null, $m['from_name'] ?? null, $at);

        foreach (['to', 'cc', 'bcc'] as $field) {
            $list = $m[$field] ?? null;
            if (is_string($list)) {
                $list = json_decode($list, true);
            }
            if (! is_array($list)) {
                continue;
            }
            foreach ($list as $entry) {
                if (is_array($entry)) {
                    self::tally($seen, $entry['email'] ?? null, $entry['name'] ?? null, $at);
                }
            }
        }
    }

    /**
     * @param  array<string, array{name: string, count: int, last: ?Carbon}>  $seen
     */
    private static function tally(array &$seen, mixed $email, mixed $name, ?Carbon $at): void
    {
        $email = mb_strtolower(trim((string) $email));
        if ($email === '' || ! str_contains($email, '@') || mb_strlen($email) > 255) {
            return;
        }
        $name = is_string($name) ? trim($name) : '';
        // A bare address echoed as its own name is no name at all.
        if (mb_strtolower($name) === $email) {
            $name = '';
        }

        $entry = $seen[$email] ?? ['name' => '', 'count' => 0, 'last' => null];
        $entry['count']++;
        if ($at && (! $entry['last'] || $at->greaterThan($entry['last']))) {
            $entry['last'] = $at;
            if ($name !== '') {
                $entry['name'] = $name;
            }
        } elseif ($name !== '' && $entry['name'] === '') {
            $entry['name'] = $name;
        }
        $seen[$email] = $entry;
    }

    private static function instant(mixed $value): ?Carbon
    {
        if ($value instanceof Carbon) {
            return $value;
        }
        if ($value instanceof \DateTimeInterface) {
            return Carbon::instance($value);
        }
        if (is_int($value) || (is_string($value) && ctype_digit($value))) {
            return Carbon::createFromTimestamp((int) $value);
        }
        if (is_string($value) && $value !== '') {
            try {
                return Carbon::parse($value);
            } catch (\Throwable) {
                return null;
            }
        }

        return null;
    }
}
