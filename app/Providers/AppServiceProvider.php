<?php

namespace App\Providers;

use App\Mail\Transport\MicrosoftGraphTransport;
use App\Support\StaySignedIn;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use SocialiteProviders\Manager\SocialiteWasCalled;
use SocialiteProviders\Microsoft\MicrosoftExtendSocialite;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // In production the app sits behind Laravel Cloud's TLS-terminating
        // proxy, so PHP sees plain http. Force https on every generated URL so
        // OAuth callbacks, signed email links and assets keep the https scheme.
        if ($this->app->environment('production')) {
            URL::forceScheme('https');
        }

        // App\Listeners\RecordAuthEvent is picked up by Laravel's automatic
        // listener discovery - do not also register it manually, or every
        // auth event gets recorded twice.

        Event::listen(SocialiteWasCalled::class, MicrosoftExtendSocialite::class);

        // Stay-signed-in remember cookie — Laravel's default is much longer;
        // keep the portal restore window to StaySignedIn::DAYS.
        Auth::guard('web')->setRememberDuration(StaySignedIn::minutes());

        Mail::extend('microsoft-graph', function () {
            $tenant = (string) config('services.microsoft.graph_tenant_id');
            $clientId = (string) config('services.microsoft.client_id');
            $clientSecret = (string) config('services.microsoft.client_secret');
            $mailbox = (string) config('services.microsoft.graph_mailbox');

            if ($tenant === '' || $tenant === 'common' || $tenant === 'organizations') {
                throw new \RuntimeException(
                    'MICROSOFT_GRAPH_TENANT_ID must be your Entra directory (tenant) ID, not "common".'
                );
            }

            if ($clientId === '' || $clientSecret === '' || $mailbox === '') {
                throw new \RuntimeException(
                    'Microsoft Graph mailer needs MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_GRAPH_MAILBOX / MAIL_FROM_ADDRESS.'
                );
            }

            return new MicrosoftGraphTransport($tenant, $clientId, $clientSecret, $mailbox);
        });

        // Public signing links are the only unauthenticated write endpoints in
        // the app. Keyed by IP: a signer legitimately saves progress often, so
        // this is generous enough not to interrupt real signing while still
        // capping automated abuse of a leaked link.
        RateLimiter::for('signing', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip());
        });
    }
}
