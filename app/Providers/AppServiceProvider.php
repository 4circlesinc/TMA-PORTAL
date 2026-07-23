<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
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

        // Public signing links are the only unauthenticated write endpoints in
        // the app. Keyed by IP: a signer legitimately saves progress often, so
        // this is generous enough not to interrupt real signing while still
        // capping automated abuse of a leaked link.
        RateLimiter::for('signing', function (Request $request) {
            return Limit::perMinute(60)->by($request->ip());
        });
    }
}
