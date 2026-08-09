<?php

namespace App\Providers;

use App\Mail\Transport\MicrosoftGraphTransport;
use App\Support\Realtime;
use App\Support\StaySignedIn;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
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
        // Portal file changes mirror out to any linked SharePoint library.
        \App\Models\FileItem::observe(\App\Observers\FileSharePointObserver::class);

        /*
         * FileAccess caches which folders are personal OneDrives — the single
         * biggest cost in a file listing. Connecting or disconnecting a drive
         * is the only thing that changes the answer, so it is also the only
         * thing that has to drop the cache. Without this the cache would fail
         * open, which is what the note on that method warned about.
         */
        \App\Models\SharePointConnection::saved(fn () => \App\Support\Files\FileAccess::forgetPersonalDrives());
        \App\Models\SharePointConnection::deleted(fn () => \App\Support\Files\FileAccess::forgetPersonalDrives());

        // A file landing in a client folder enters that client's review queue,
        // whichever of the seven upload paths put it there.
        \App\Models\FileItem::observe(\App\Observers\ClientDocumentObserver::class);

        // …and tell any open File Library to refetch itself.
        \App\Models\FileItem::observe(\App\Observers\FileLibraryObserver::class);
        \App\Models\Folder::observe(\App\Observers\FileLibraryObserver::class);

        // An account type or status change reaches the person it is about
        // straight away, not on their next refresh.
        \App\Models\User::observe(\App\Observers\UserAccountObserver::class);

        // The client hub keeps up with whoever else is editing it.
        \App\Models\Client::observe(\App\Observers\ClientDirectoryObserver::class);
        \App\Models\Company::observe(\App\Observers\ClientDirectoryObserver::class);
        \App\Models\ClientAssignment::observe(\App\Observers\ClientDirectoryObserver::class);

        /*
         * The rest of the list surfaces. Class names, not instances:
         * Model::observe() registers by class and resolves from the container
         * when an event fires, so an instance is discarded and a constructor
         * argument throws on the first write. See LiveResourceObserver.
         */
        /*
         * The file viewer's side panels. Comments and presence were already
         * live; without these the Versions and Approvals tabs beside them sat
         * on whatever was true when the file was opened.
         */
        /*
         * Comments and approval requests keep a client document's review
         * status current, so nobody has to maintain it by hand — see
         * App\Support\Files\ReviewAuto for what it refuses to overwrite.
         */
        \App\Models\FileComment::observe(\App\Observers\ReviewActivityObserver::class);
        \App\Models\FileWorkflow::observe(\App\Observers\ReviewActivityObserver::class);

        \App\Models\FileVersion::observe(\App\Observers\FileDetailObserver::class);
        \App\Models\FileWorkflow::observe(\App\Observers\FileDetailObserver::class);
        \App\Models\FileWorkflowStep::observe(\App\Observers\FileDetailObserver::class);
        \App\Models\FileWorkflowEvent::observe(\App\Observers\FileDetailObserver::class);
        \App\Models\FileActivity::observe(\App\Observers\FileDetailObserver::class);

        \App\Models\Contact::observe(\App\Observers\ContactObserver::class);
        \App\Models\Calendar::observe(\App\Observers\CalendarLiveObserver::class);
        \App\Models\CalendarEvent::observe(\App\Observers\CalendarLiveObserver::class);
        \App\Models\SignatureRequest::observe(\App\Observers\SignatureLiveObserver::class);
        \App\Models\SignatureRecipient::observe(\App\Observers\SignatureLiveObserver::class);

        /*
         * Send whatever a job collected.
         *
         * Live defers its broadcasts to the end of the request, but a queue
         * worker is one long-lived process with no request to end — without
         * this, everything a job signalled would sit in memory until the
         * worker was restarted, which is indistinguishable from live updates
         * simply not working for anything the queue does (SharePoint sync,
         * mail import, thumbnails).
         */
        Queue::after(fn () => Realtime\Live::flush());
        Queue::failing(fn () => Realtime\Live::flush());

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

        // Invitation links are unauthenticated and one of them can create an
        // account, so they are capped tighter than signing. A real invitee
        // loads the page and submits once; anything past this is someone
        // walking tokens.
        RateLimiter::for('invitations', function (Request $request) {
            return Limit::perMinute(20)->by($request->ip());
        });
    }
}
