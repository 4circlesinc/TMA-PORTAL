<?php

namespace App\Console\Commands;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\PushTransport;
use Illuminate\Console\Command;

/**
 * `php artisan push:status [--test=email]`
 *
 * Says whether push is configured and whether Google accepts the service
 * account, counts the registered devices, and with --test sends a real
 * notification to that person through the normal path. Made to be run from
 * Laravel Cloud's Commands panel, where there is no shell.
 */
class PushStatus extends Command
{
    protected $signature = 'push:status {--test= : Send a test notification to the user with this email}';

    protected $description = 'Report the push (FCM) configuration and optionally send a test notification';

    public function handle(PushTransport $transport): int
    {
        $project = (string) config('services.fcm.project_id');
        $credentials = (string) config('services.fcm.credentials');
        $this->line('Project id:   '.($project !== '' ? $project : '(not set)'));
        $this->line('Credentials:  '.match (true) {
            $credentials === '' => '(not set)',
            str_starts_with(ltrim($credentials), '{') => 'JSON in FCM_CREDENTIALS_JSON',
            is_file($credentials) => 'file '.$credentials,
            default => 'FCM_CREDENTIALS_JSON is neither JSON nor a readable file',
        });

        if (! $transport->enabled()) {
            $this->error('Push is OFF: set FCM_PROJECT_ID and FCM_CREDENTIALS_JSON (a service-account JSON) and redeploy.');

            return self::FAILURE;
        }

        // A token Google cannot know: "unregistered" proves the service account signed in and FCM answered.
        $probe = $transport->send('push-status-probe', ['kind' => 'probe']);
        $this->line('Google auth:  '.match ($probe) {
            PushTransport::UNREGISTERED => 'OK (FCM answered)',
            PushTransport::OK => 'OK',
            default => 'FAILED — check the service account JSON and that the Firebase Cloud Messaging API is enabled (see storage/logs)',
        });

        $devices = DeviceToken::query()->selectRaw('platform, count(*) as n')->groupBy('platform')->pluck('n', 'platform');
        $this->line('Devices:      '.($devices->isEmpty() ? 'none registered yet' : $devices->map(fn ($n, $p) => "$p: $n")->implode(', ')));

        $email = (string) $this->option('test');
        if ($email !== '') {
            $user = User::query()->where('email', $email)->first();
            if (! $user) {
                $this->error("No user with email $email");

                return self::FAILURE;
            }
            $count = DeviceToken::query()->where('user_id', $user->id)->count();
            $sent = Notifier::send([
                'user' => $user,
                'type' => 'system.sync_completed',
                'title' => 'Push test',
                'message' => 'If you can read this in your phone\'s notifications, push works.',
                'action_url' => '/notifications',
                'email' => false,
            ]);
            $this->line($sent
                ? "Test sent to {$user->name} ({$count} device".($count === 1 ? '' : 's').'); the queue worker delivers it.'
                : 'The test was not created (the person may have that group silenced).');
        }

        return $probe === PushTransport::FAILED ? self::FAILURE : self::SUCCESS;
    }
}
