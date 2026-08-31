<?php

namespace App\Support\Microsoft;

use App\Jobs\SyncMailbox;
use App\Jobs\SyncSharePointLibrary;
use App\Models\ConnectedAccount;
use App\Models\GraphSubscription;
use App\Models\SharePointConnection;
use App\Support\Mail\MailTokens;
use App\Support\SharePoint\GraphClient;
use App\Support\SharePoint\GraphException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Microsoft Graph change notifications for mailbox and OneDrive.
 *
 * Cron cannot fire faster than a minute, which is why a mailbox nobody has
 * open (and a OneDrive after the first import) used to sit until the next
 * tick. Graph POSTs here the moment something changes; we dispatch the same
 * incremental jobs the scheduler already uses. Polling stays as the fallback
 * for local/http installs and for Google mail, which has no equivalent here.
 */
class ChangeNotifications
{
    /** Outlook message subscriptions cap at 4230 minutes; stay safely under. */
    private const MAIL_TTL_MINUTES = 4000;

    /** DriveItem subscriptions allow the same window on a work OneDrive. */
    private const DRIVE_TTL_MINUTES = 4000;

    public static function webhookUrl(): ?string
    {
        $configured = trim((string) config('services.microsoft.graph_webhook_url'));
        $url = $configured !== ''
            ? $configured
            : rtrim((string) config('app.url'), '/').'/hooks/microsoft-graph';

        // Graph will only POST to HTTPS. localhost http is a no-op, not an error —
        // the minute scheduler and the page's live check still run.
        if (! str_starts_with($url, 'https://')) {
            return null;
        }

        return $url;
    }

    public static function ensureMail(ConnectedAccount $account): void
    {
        if ($account->provider !== 'microsoft' || ! $account->sync_email || ! $account->token) {
            return;
        }

        $url = self::webhookUrl();
        if ($url === null) {
            return;
        }

        $existing = GraphSubscription::query()
            ->where('kind', GraphSubscription::KIND_MAIL)
            ->where('connected_account_id', $account->id)
            ->first();

        if ($existing && ! $existing->isExpiringSoon()) {
            return;
        }

        try {
            if ($existing) {
                self::renewDelegated($account, $existing, self::MAIL_TTL_MINUTES);

                return;
            }

            self::createDelegated($account, $url, 'me/messages', 'created,updated,deleted', self::MAIL_TTL_MINUTES);
        } catch (\Throwable $e) {
            Log::info('Graph mail subscription skipped', [
                'account' => $account->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public static function ensureDrive(SharePointConnection $connection): void
    {
        if (! $connection->sync_enabled || ! GraphClient::isConfigured()) {
            return;
        }

        $url = self::webhookUrl();
        if ($url === null) {
            return;
        }

        $existing = GraphSubscription::query()
            ->where('kind', GraphSubscription::KIND_DRIVE)
            ->where('sharepoint_connection_id', $connection->id)
            ->first();

        if ($existing && ! $existing->isExpiringSoon()) {
            return;
        }

        $resource = '/drives/'.$connection->drive_id.'/root';

        try {
            if ($existing) {
                self::renewApp($existing, self::DRIVE_TTL_MINUTES);

                return;
            }

            self::createApp($connection, $url, $resource, 'updated', self::DRIVE_TTL_MINUTES);
        } catch (\Throwable $e) {
            Log::info('Graph drive subscription skipped', [
                'connection' => $connection->uuid,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public static function releaseMail(ConnectedAccount $account): void
    {
        GraphSubscription::query()
            ->where('kind', GraphSubscription::KIND_MAIL)
            ->where('connected_account_id', $account->id)
            ->get()
            ->each(fn (GraphSubscription $row) => self::forget($row, $account));
    }

    public static function releaseDrive(SharePointConnection $connection): void
    {
        GraphSubscription::query()
            ->where('kind', GraphSubscription::KIND_DRIVE)
            ->where('sharepoint_connection_id', $connection->id)
            ->get()
            ->each(fn (GraphSubscription $row) => self::forget($row));
    }

    /** Create or renew every live mailbox and library. */
    public static function ensureAll(): void
    {
        if (self::webhookUrl() === null) {
            return;
        }

        ConnectedAccount::query()
            ->where('provider', 'microsoft')
            ->where('sync_email', true)
            ->whereNotNull('token')
            ->each(fn (ConnectedAccount $account) => self::ensureMail($account));

        SharePointConnection::query()
            ->where('sync_enabled', true)
            ->each(fn (SharePointConnection $connection) => self::ensureDrive($connection));
    }

    /**
     * A Graph POST about something that changed (or a lifecycle event).
     *
     * Must return quickly — Graph retries if we take more than a few seconds,
     * so the work is the existing queued sync, never an inline walk.
     *
     * @param  array<string, mixed>  $notification
     */
    public static function handle(array $notification): void
    {
        $subscriptionId = (string) ($notification['subscriptionId'] ?? '');
        $clientState = (string) ($notification['clientState'] ?? '');

        if ($subscriptionId === '') {
            return;
        }

        $row = GraphSubscription::query()
            ->where('graph_subscription_id', $subscriptionId)
            ->first();

        if (! $row || ! hash_equals($row->client_state, $clientState)) {
            return;
        }

        $row->forceFill(['last_notified_at' => now(), 'last_error' => null])->save();

        $lifecycle = (string) ($notification['lifecycleEvent'] ?? '');

        if ($lifecycle !== '') {
            self::lifecycle($row, $lifecycle);

            return;
        }

        self::dispatchFor($row);
    }

    private static function lifecycle(GraphSubscription $row, string $event): void
    {
        if ($event === 'missed') {
            self::dispatchFor($row);

            return;
        }

        // subscriptionRemoved / reauthorizationRequired: drop the row and
        // mint a new one. The ensure path is what Graph's handshake hits.
        $account = $row->account;
        $connection = $row->connection;
        $kind = $row->kind;
        self::forget($row, $account);

        if ($kind === GraphSubscription::KIND_MAIL && $account) {
            self::ensureMail($account);
        } elseif ($kind === GraphSubscription::KIND_DRIVE && $connection) {
            self::ensureDrive($connection);
        }
    }

    private static function dispatchFor(GraphSubscription $row): void
    {
        if ($row->kind === GraphSubscription::KIND_MAIL && $row->connected_account_id) {
            $account = $row->account ?: ConnectedAccount::find($row->connected_account_id);

            if ($account && $account->sync_email) {
                SyncMailbox::dispatch($account);
            }

            return;
        }

        if ($row->kind === GraphSubscription::KIND_DRIVE && $row->sharepoint_connection_id) {
            SyncSharePointLibrary::dispatch((int) $row->sharepoint_connection_id);
        }
    }

    private static function createDelegated(
        ConnectedAccount $account,
        string $url,
        string $resource,
        string $changeType,
        int $ttlMinutes,
    ): void {
        $state = Str::random(40);
        $payload = self::payload($url, $resource, $changeType, $state, $ttlMinutes);
        $created = self::delegated($account)->post('https://graph.microsoft.com/v1.0/subscriptions', $payload);

        if (! $created->successful()) {
            throw new GraphException(
                'Graph POST /subscriptions failed ('.$created->status().'): '.
                ($created->json('error.message') ?? $created->body()),
                $created->status()
            );
        }

        self::store($created->json(), GraphSubscription::KIND_MAIL, $state, $resource, $account, null);
    }

    private static function createApp(
        SharePointConnection $connection,
        string $url,
        string $resource,
        string $changeType,
        int $ttlMinutes,
    ): void {
        $state = Str::random(40);
        $created = GraphClient::request('POST', '/subscriptions', [], self::payload(
            $url, $resource, $changeType, $state, $ttlMinutes
        ));

        self::store($created, GraphSubscription::KIND_DRIVE, $state, $resource, null, $connection);
    }

    private static function renewDelegated(ConnectedAccount $account, GraphSubscription $row, int $ttlMinutes): void
    {
        $response = self::delegated($account)->patch(
            'https://graph.microsoft.com/v1.0/subscriptions/'.$row->graph_subscription_id,
            ['expirationDateTime' => self::expires($ttlMinutes)],
        );

        if ($response->status() === 404) {
            self::forget($row, $account);
            self::ensureMail($account);

            return;
        }

        if (! $response->successful()) {
            throw new GraphException(
                'Graph PATCH /subscriptions failed ('.$response->status().'): '.
                ($response->json('error.message') ?? $response->body()),
                $response->status()
            );
        }

        $row->forceFill(['expires_at' => $response->json('expirationDateTime') ?? now()->addMinutes($ttlMinutes)])->save();
    }

    private static function renewApp(GraphSubscription $row, int $ttlMinutes): void
    {
        try {
            $updated = GraphClient::request('PATCH', '/subscriptions/'.$row->graph_subscription_id, [], [
                'expirationDateTime' => self::expires($ttlMinutes),
            ]);
        } catch (GraphException $e) {
            if ($e->status === 404) {
                $connection = $row->connection;
                self::forget($row);
                if ($connection) {
                    self::ensureDrive($connection);
                }

                return;
            }

            throw $e;
        }

        $row->forceFill(['expires_at' => $updated['expirationDateTime'] ?? now()->addMinutes($ttlMinutes)])->save();
    }

    private static function forget(GraphSubscription $row, ?ConnectedAccount $account = null): void
    {
        try {
            if ($row->kind === GraphSubscription::KIND_MAIL && $account) {
                self::delegated($account)
                    ->delete('https://graph.microsoft.com/v1.0/subscriptions/'.$row->graph_subscription_id);
            } else {
                GraphClient::request('DELETE', '/subscriptions/'.$row->graph_subscription_id);
            }
        } catch (\Throwable) {
            // Already gone on Graph's side is the usual case.
        }

        $row->delete();
    }

    /** @param  array<string, mixed>  $created */
    private static function store(
        array $created,
        string $kind,
        string $state,
        string $resource,
        ?ConnectedAccount $account,
        ?SharePointConnection $connection,
    ): void {
        $id = (string) ($created['id'] ?? '');
        if ($id === '') {
            throw new GraphException('Graph created a subscription without an id.');
        }

        GraphSubscription::create([
            'uuid' => (string) Str::uuid(),
            'kind' => $kind,
            'connected_account_id' => $account?->id,
            'sharepoint_connection_id' => $connection?->id,
            'graph_subscription_id' => $id,
            'resource' => $resource,
            'client_state' => $state,
            'expires_at' => $created['expirationDateTime'] ?? now()->addDays(2),
        ]);
    }

    /** @return array<string, mixed> */
    private static function payload(string $url, string $resource, string $changeType, string $state, int $ttlMinutes): array
    {
        return [
            'changeType' => $changeType,
            'notificationUrl' => $url,
            'lifecycleNotificationUrl' => $url,
            'resource' => $resource,
            'expirationDateTime' => self::expires($ttlMinutes),
            'clientState' => $state,
        ];
    }

    private static function expires(int $minutes): string
    {
        return now()->utc()->addMinutes($minutes)->format('Y-m-d\TH:i:s.0000000\Z');
    }

    private static function delegated(ConnectedAccount $account): PendingRequest
    {
        return Http::withToken(MailTokens::accessToken($account))
            ->acceptJson()
            ->connectTimeout(10)
            ->timeout(20);
    }
}
