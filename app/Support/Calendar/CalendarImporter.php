<?php

namespace App\Support\Calendar;

use App\Jobs\SyncProviderCalendar;
use App\Models\Calendar;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\Calendar\Sync\ProviderFactory;
use Illuminate\Support\Str;

/**
 * One-shot "mirror every calendar this account can see": discovery, creation,
 * subscription and the background sync kick. Shared by the Connect-all button
 * and the post-OAuth auto-import so both behave identically; discovery skips
 * calendars that are already mirrored, so running it again is harmless.
 */
class CalendarImporter
{
    /**
     * @return array{found: int, added: Calendar[], skipped: int, failed: array}
     *
     * @throws \App\Support\Calendar\Sync\CalendarSyncException when the
     *         provider cannot list calendars (bad token, revoked consent).
     */
    public static function importAll(User $user, ConnectedAccount $account, string $direction = 'two_way', int $monthsBack = 3): array
    {
        if (in_array($direction, ['two_way', 'export'], true) && ! $account->canWriteCalendar()) {
            $direction = 'import';
        }

        $remote = ProviderFactory::for($account)->listCalendars();

        $already = Calendar::where('connected_account_id', $account->id)
            ->pluck('external_id')
            ->all();

        $palette = CalendarColours::keys();
        $added = [];
        $skipped = 0;
        $failed = [];
        $colourIndex = 0;

        foreach ($remote as $remoteCal) {
            $externalId = (string) ($remoteCal['id'] ?? '');
            if ($externalId === '') {
                continue;
            }
            if (in_array($externalId, $already, true)) {
                $skipped++;

                continue;
            }

            try {
                $remoteCanWrite = ! empty($remoteCal['canWrite']);
                $calendar = Calendar::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => $remoteCal['name'] ?? 'Calendar',
                    'colour' => $palette[$colourIndex % count($palette)] ?? CalendarColours::DEFAULT,
                    'calendar_type' => Calendar::TYPE_PERSONAL,
                    'owner_id' => $user->id,
                    'created_by' => $user->id,
                    'timezone' => CalendarProvisioner::defaultTimezone($user),
                    'visibility' => 'private',
                    'source' => $account->provider,
                    'connected_account_id' => $account->id,
                    'external_id' => $externalId,
                    'sync_direction' => ($remoteCanWrite && $direction !== 'import')
                        ? $direction
                        : 'import',
                    'remote_can_write' => $remoteCanWrite,
                    'sync_window_start' => now()->subMonths($monthsBack),
                    'subscription_status' => 'syncing',
                ]);

                CalendarProvisioner::subscribe($user, $calendar);
                CalendarAudit::record(
                    CalendarAudit::CALENDAR_CONNECTED,
                    $user,
                    $calendar,
                    context: ['provider' => $account->provider, 'bulk' => true],
                );
                SyncProviderCalendar::dispatch($calendar->id);

                $added[] = $calendar;
                $already[] = $externalId;
                $colourIndex++;
            } catch (\Throwable $e) {
                $failed[] = [
                    'externalId' => $externalId,
                    'name' => $remoteCal['name'] ?? 'Calendar',
                    'error' => mb_substr($e->getMessage(), 0, 200),
                ];
            }
        }

        return [
            'found' => count($remote),
            'added' => $added,
            'skipped' => $skipped,
            'failed' => $failed,
        ];
    }
}
