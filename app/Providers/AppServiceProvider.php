<?php

namespace App\Providers;

use App\Mail\Transport\MicrosoftGraphTransport;
use App\Support\Realtime;
use App\Support\StaySignedIn;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Console\Migrations\RollbackCommand;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
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
        /*
         * migrate:fresh / refresh / reset / db:wipe drop every table.
         * --force does not override this. PHPUnit stays allowed because
         * RefreshDatabase calls migrate:fresh against in-memory SQLite.
         * One-step rollback stays available (README; a deploy fix).
         */
        DB::prohibitDestructiveCommands(! $this->app->runningUnitTests());
        RollbackCommand::prohibit(false);

        // Portal file changes mirror out to any linked SharePoint library.
        \App\Models\FileItem::observe(\App\Observers\FileSharePointObserver::class);
        \App\Models\Folder::observe(\App\Observers\FolderSharePointObserver::class);

        /*
         * FileAccess caches which folders are personal OneDrives — the single
         * biggest cost in a file listing. Connecting or disconnecting a drive
         * is the only thing that changes the answer, so it is also the only
         * thing that has to drop the cache. Without this the cache would fail
         * open, which is what the note on that method warned about.
         */
        \App\Models\SharePointConnection::saved(fn () => \App\Support\Files\FileAccess::forgetPersonalDrives());
        \App\Models\SharePointConnection::deleted(fn () => \App\Support\Files\FileAccess::forgetPersonalDrives());

        /*
         * The other access memos. Shares and company memberships feed
         * FileAccess::shareRole; memberships, providers, clients and
         * applications feed FolderAccess::clientIdsFor and
         * ContactIdentity::idsFor. Each is asked many times in one request
         * and answered from memory, so the write that changes the answer is
         * what drops it — a share granted mid-request must open the file in
         * that same request. Clients, applications and providers are written
         * constantly for reasons that move no grant (an import, a sync, a
         * status), so those only count when the column that feeds the memo
         * changed.
         */
        $forget = fn () => \App\Support\Files\FileAccess::forgetGrants();
        $whenChanged = fn (array $columns) => function ($model) use ($columns, $forget) {
            if ($model->wasRecentlyCreated || $model->wasChanged($columns)) {
                $forget();
            }
        };

        /*
         * A queue worker is one PHP process serving thousands of jobs, and
         * every memo above would otherwise live for all of them — including
         * grants revoked by a web request this process never saw. Model
         * events only fire in the process that writes, so cross-process
         * invalidation does not exist: the only safe worker is one that
         * starts every job with a cold access cache, exactly like a fresh
         * request. Folder rows and personal-drive flags go too — a drive
         * connected by one job must be private in the next.
         */
        \Illuminate\Support\Facades\Queue::before(
            fn () => \App\Support\Files\FileAccess::forgetFolders()
        );

        \App\Models\Share::saved($forget);
        \App\Models\Share::deleted($forget);
        \App\Models\CompanyMember::saved($forget);
        \App\Models\CompanyMember::deleted($forget);
        // Assignments end rather than delete, and an ended one moves grants
        // exactly as a deleted one would.
        \App\Models\CompanyStaffAssignment::saved($forget);
        \App\Models\CompanyStaffAssignment::deleted($forget);
        \App\Models\ClientAssignment::saved($forget);
        \App\Models\ClientAssignment::deleted($forget);
        // The org-wide default and its role feed organizationDefaultRole.
        \App\Models\FileLibrarySetting::saved($forget);
        \App\Models\CipProvider::saved($whenChanged(['company_id']));
        \App\Models\CipProvider::deleted($forget);
        \App\Models\CipApplication::saved($whenChanged(['provider_id', 'client_id']));
        \App\Models\CipApplication::deleted($forget);
        \App\Models\Client::saved($whenChanged(['referred_by_company_id', 'user_id']));
        \App\Models\Client::deleted($forget);

        // A file landing in a client folder enters that client's review queue,
        // whichever of the seven upload paths put it there.
        \App\Models\FileItem::observe(\App\Observers\ClientDocumentObserver::class);

        // A CIP checklist upload through the library must land in its slot.
        \App\Models\FileItem::observe(\App\Observers\CipFileObserver::class);

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

        // The file row itself: a review-status change reaches open viewers
        // (the observer ignores every other FileItem write). CipDocument is in
        // the list because a checklist slot's status IS the pill on its file,
        // and judging from the application page never touches a file column.
        \App\Models\FileItem::observe(\App\Observers\FileDetailObserver::class);
        \App\Models\CipDocument::observe(\App\Observers\FileDetailObserver::class);
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

        // Document-request links accept file *writes* from people with no
        // account, so they are capped harder than either of the above. The
        // ceiling still clears a real client dropping a folder of scans in one
        // go — the page posts them one at a time — while a leaked link cannot
        // be used to fill the vault.
        RateLimiter::for('uploads', function (Request $request) {
            return Limit::perMinute(30)->by($request->ip());
        });
    }
}
