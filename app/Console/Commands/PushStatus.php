<?php

namespace App\Console\Commands;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\ApnsClient;
use App\Support\Notifications\FcmClient;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\PushTransport;
use Illuminate\Console\Command;

/**
 * `php artisan push:status [--test=email]`
 *
 * Says whether push is configured for Android (FCM) and iPhone (APNs), and
 * whether Google and Apple each accept the credentials, counts the registered
 * devices, and with --test sends a real notification to that person through
 * the normal path. Made to be run from Laravel Cloud's Commands panel, where
 * there is no shell.
 */
class PushStatus extends Command
{
    protected $signature = 'push:status {--test= : Send a test notification to the user with this email}';

    protected $description = 'Report the push (FCM and APNs) configuration and optionally send a test notification';

    public function handle(PushTransport $transport, FcmClient $fcm, ApnsClient $apns): int
    {
        $this->line('Android (FCM)');
        $project = (string) config('services.fcm.project_id');
        $credentials = (string) config('services.fcm.credentials');
        $this->line('Project id:   '.($project !== '' ? $project : '(not set)'));
        $this->line('Credentials:  '.match (true) {
            $credentials === '' => '(not set)',
            str_starts_with(ltrim($credentials), '{') => 'JSON in FCM_CREDENTIALS_JSON',
            is_file($credentials) => 'file '.$credentials,
            default => 'FCM_CREDENTIALS_JSON is neither JSON nor a readable file',
        });

        $failed = false;
        if ($fcm->enabled()) {
            // A token Google cannot know: "unregistered" proves the service account signed in and FCM answered.
            $probe = $fcm->send('push-status-probe', ['kind' => 'probe']);
            $failed = $probe === PushTransport::FAILED;
            $this->line('Google auth:  '.match ($probe) {
                PushTransport::UNREGISTERED => 'OK (FCM answered)',
                PushTransport::OK => 'OK',
                default => 'FAILED - check the service account JSON and that the Firebase Cloud Messaging API is enabled (see storage/logs)',
            });
        } else {
            $this->line('Google auth:  not set up, Android phones get no push');
        }

        $this->line('');
        $this->line('iPhone (APNs)');
        $this->line('Key id:       '.((string) config('services.apns.key_id') ?: '(not set)'));
        $this->line('Team id:      '.((string) config('services.apns.team_id') ?: '(not set)'));
        $this->line('Bundle id:    '.((string) config('services.apns.bundle_id') ?: '(not set)'));
        $keyProblem = $apns->keyProblem();
        $this->line('Private key:  '.match (true) {
            (string) config('services.apns.private_key') === '' => '(not set)',
            $keyProblem !== null => 'set, but unusable: '.$keyProblem,
            default => 'set',
        });
        if ($keyProblem !== null) {
            $failed = true;
            $this->line('Apple auth:   not tried, the key cannot be read');
        } elseif ($apns->enabled()) {
            $check = $apns->check();
            $failed = $failed || ! $check['ok'];
            $this->line('Apple auth:   '.$check['detail']);
        } else {
            $this->line('Apple auth:   not set up, iPhones get no push');
        }
        $this->line('');

        if (! $transport->enabled()) {
            $this->error('Push is OFF. Android: set FCM_PROJECT_ID and FCM_CREDENTIALS_JSON. iPhone: set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_PRIVATE_KEY. Then redeploy.');

            return self::FAILURE;
        }

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
                // There is no /notifications page; the inbox is an Overview tab.
                'action_url' => '/overview?tab=notifications',
                'email' => false,
            ]);
            $this->line($sent
                ? "Test sent to {$user->name} ({$count} device".($count === 1 ? '' : 's').'); the queue worker delivers it.'
                : 'The test was not created (the person may have that group silenced).');
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
