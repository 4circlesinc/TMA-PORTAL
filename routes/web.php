<?php

use App\Http\Controllers\AccountSetupController;
use App\Http\Controllers\ActivityController;
use App\Http\Controllers\AdminRecycleBinController;
use App\Http\Controllers\AdminSecurityController;
use App\Http\Controllers\AdminUsersController;
use App\Http\Controllers\AuthenticatorNudgeController;
use App\Http\Controllers\AvailabilityController;
use App\Http\Controllers\AvatarController;
use App\Http\Controllers\BackgroundOperationsController;
use App\Http\Controllers\BrandingController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\CalendarEventController;
use App\Http\Controllers\CalendarIcsController;
use App\Http\Controllers\CalendarSyncController;
use App\Http\Controllers\CallRecordingController;
use App\Http\Controllers\Cbi\CbiController;
use App\Http\Controllers\Cip\CipApplicationController;
use App\Http\Controllers\Cip\CipAssignmentController;
use App\Http\Controllers\Cip\CipDashboardController;
use App\Http\Controllers\Cip\CipDistributionController;
use App\Http\Controllers\Cip\CipDocumentCommentController;
use App\Http\Controllers\Cip\CipDocumentUploadController;
use App\Http\Controllers\Cip\CipEventController;
use App\Http\Controllers\Cip\CipLetterController;
use App\Http\Controllers\Cip\CipPersonStatusController;
use App\Http\Controllers\Cip\CipRequirementController;
use App\Http\Controllers\Cip\CipReviewController;
use App\Http\Controllers\Cip\CipThreadController;
use App\Http\Controllers\Cip\CipTransitionController;
use App\Http\Controllers\ClientAssignmentController;
use App\Http\Controllers\ClientConversationController;
use App\Http\Controllers\ClientCustomFieldsController;
use App\Http\Controllers\ClientHubSettingsController;
use App\Http\Controllers\ClientInviteController;
use App\Http\Controllers\ClientOnboardingController;
use App\Http\Controllers\ClientsController;
use App\Http\Controllers\CompaniesController;
use App\Http\Controllers\CompanyMemberController;
use App\Http\Controllers\CompanyStaffController;
use App\Http\Controllers\ConnectorsController;
use App\Http\Controllers\ContactsController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DashboardMetricsController;
use App\Http\Controllers\DashboardWorkController;
use App\Http\Controllers\Design\MailPreviewController;
use App\Http\Controllers\DesktopAssetsController;
use App\Http\Controllers\DesktopAuthController;
use App\Http\Controllers\DesktopReleasesController;
use App\Http\Controllers\DesktopUpdateController;
use App\Http\Controllers\DevDatabaseController;
use App\Http\Controllers\EmailTwoFactorController;
use App\Http\Controllers\EmailVerificationStatusController;
use App\Http\Controllers\Feed\FeedAnalyticsController;
use App\Http\Controllers\Feed\FeedAttachmentController;
use App\Http\Controllers\Feed\FeedChannelController;
use App\Http\Controllers\Feed\FeedCommentController;
use App\Http\Controllers\Feed\FeedPollController;
use App\Http\Controllers\Feed\FeedPostController;
use App\Http\Controllers\Feed\FeedReactionController;
use App\Http\Controllers\Feed\FeedSearchController;
use App\Http\Controllers\FileLibraryController;
use App\Http\Controllers\Files\BrowserController;
use App\Http\Controllers\Files\BulkController;
use App\Http\Controllers\Files\FavoriteController;
use App\Http\Controllers\Files\FileCommentController;
use App\Http\Controllers\Files\FileController;
use App\Http\Controllers\Files\FilePresenceController;
use App\Http\Controllers\Files\FileRequestController;
use App\Http\Controllers\Files\FileReviewController;
use App\Http\Controllers\Files\FileVersionController;
use App\Http\Controllers\Files\FileViewerController;
use App\Http\Controllers\Files\FileWorkflowController;
use App\Http\Controllers\Files\FolderController;
use App\Http\Controllers\Files\PublicShareController;
use App\Http\Controllers\Files\PublicUploadController;
use App\Http\Controllers\Files\RecycleBinController;
use App\Http\Controllers\Files\ShareController;
use App\Http\Controllers\Files\ShortcutController;
use App\Http\Controllers\Files\SyncController as FilesSyncController;
use App\Http\Controllers\Files\SyncStatusController;
use App\Http\Controllers\Files\ThumbnailController;
use App\Http\Controllers\Files\UploadController;
use App\Http\Controllers\Files\WorkflowHubController;
use App\Http\Controllers\GettingStartedController;
use App\Http\Controllers\GraphWebhookController;
use App\Http\Controllers\GroupsController;
use App\Http\Controllers\InvitationAcceptController;
use App\Http\Controllers\InvitationController;
use App\Http\Controllers\LegacyPageController;
use App\Http\Controllers\MailController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\MeOneDriveController;
use App\Http\Controllers\MessagingAttachmentController;
use App\Http\Controllers\MessagingController;
use App\Http\Controllers\MessagingGroupController;
use App\Http\Controllers\MeSyncStatusController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\NotificationHistoryController;
use App\Http\Controllers\PeopleController;
use App\Http\Controllers\PortalPermissionsController;
use App\Http\Controllers\PreferencesController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProfileSetupController;
use App\Http\Controllers\ReportsController;
use App\Http\Controllers\SecuritySettingsController;
use App\Http\Controllers\ServiceTeamsController;
use App\Http\Controllers\Signatures\PublicSigningController;
use App\Http\Controllers\Signatures\SignatureFieldController;
use App\Http\Controllers\Signatures\SignatureRequestController;
use App\Http\Controllers\SignInActivityController;
use App\Http\Controllers\SocialAuthController;
use App\Http\Controllers\StaffPresenceController;
use App\Http\Controllers\StaySignedInController;
use App\Http\Controllers\StorageUsageController;
use App\Http\Controllers\TemplatesController;
use App\Http\Controllers\UnsignedVerifyEmailController;
use App\Support\Access\Role;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Profile photos. Signed-in only, but deliberately outside every onboarding
 * gate: the profile-setup and onboarding screens show the photo we pulled from
 * the person's Google/Microsoft account, and those screens run *before*
 * 'profile.complete' passes. Gated with the portal, the <img> would follow a
 * redirect back to the setup page and render as a broken image.
 */
Route::middleware(['auth'])->group(function () {
    Route::get('/media/avatars/{name}', [AvatarController::class, 'show'])->name('avatar.show');

    // The company logo, for the same reason: the onboarding and profile-setup
    // screens wear the firm's branding before 'profile.complete' passes.
    Route::get('/media/branding/{name}', [BrandingController::class, 'logo'])->name('branding.logo');

    // Poll target for the "Confirm your email" screen — another device may
    // have already followed the signed link.
    Route::get('/auth/email/verification-status', EmailVerificationStatusController::class)
        ->name('verification.status');
});

/*
 * Confirm email from the signed link without requiring an active session.
 * Fortify still registers the authenticated verify route; the mail points here.
 */
Route::get('/auth/email/confirm/{id}/{hash}', UnsignedVerifyEmailController::class)
    ->middleware(['signed', 'throttle:6,1'])
    ->name('verification.verify.unsigned');

/*
 * Microsoft Graph change notifications. Must be reachable without a session
 * and without CSRF — Graph's handshake is an unauthenticated POST with a
 * validationToken query string, and notifications are JSON with a clientState
 * we minted ourselves.
 */
Route::post('/hooks/microsoft-graph', GraphWebhookController::class)
    ->middleware('throttle:120,1')
    ->name('hooks.microsoft-graph');

/*
 * Portal - requires login, verified email, and administrator approval.
 */
Route::middleware(['auth', 'verified', 'profile.complete', 'account.approved', 'onboarded', 'mfa.enforced'])->group(function () {
    Route::get('/', DashboardController::class);

    // KPI cards on the portal home. Staff and service-provider contacts:
    // see DashboardMetricsController.
    Route::get('/portal/dashboard/metrics', DashboardMetricsController::class)
        ->name('dashboard.metrics');

    // Team presence board on the portal home (online + work-plan status).
    Route::get('/portal/dashboard/staff', StaffPresenceController::class)
        ->name('dashboard.staff');

    // Requests and comments tiles on the portal home. Read-only, and the same
    // reads the Workflows section uses — see DashboardWorkController.
    Route::get('/portal/dashboard/work', DashboardWorkController::class)
        ->name('dashboard.work');

    // Recent sign-ins across the firm, for the Overview card. Staff-gated
    // inside the controller — clients never see who signed in.
    Route::get('/portal/sign-ins', SignInActivityController::class)
        ->name('portal.sign-ins');

    // All settings now live in Account settings; this preserved URL (and
    // the flashes Fortify/social redirects attach to it) forwards there.
    Route::get('/security-settings', function (Request $request) {
        $params = ['settings-page' => 'account-security'];

        if ($reason = session('social_error')) {
            $params['notice'] = 'social-error';
            $params['reason'] = $reason;
        } elseif ($notice = session('status') ?? $request->query('notice')) {
            $params['notice'] = $notice;
        }

        return redirect('/account-settings?'.http_build_query($params));
    })->name('security-settings');

    Route::get('/security-settings/data', [SecuritySettingsController::class, 'data'])
        ->name('security-settings.data');

    Route::post('/security-settings/logout-others', [SecuritySettingsController::class, 'logoutOtherDevices'])
        ->name('security-settings.logout-others');

    Route::post('/security-settings/two-factor-app', [SecuritySettingsController::class, 'setTwoFactorApp'])
        ->name('security-settings.two-factor-app');

    Route::delete('/security-settings/trusted-devices/{device}', [SecuritySettingsController::class, 'revokeTrustedDevice'])
        ->name('security-settings.trusted-devices.revoke');

    Route::delete('/security-settings/trusted-devices', [SecuritySettingsController::class, 'revokeAllTrustedDevices'])
        ->name('security-settings.trusted-devices.revoke-all');

    Route::put('/security-settings/phone', [SecuritySettingsController::class, 'updatePhone'])
        ->name('security-settings.phone.update');

    Route::delete('/security-settings/phone', [SecuritySettingsController::class, 'removePhone'])
        ->name('security-settings.phone.remove');

    Route::put('/security-settings/alerts', [SecuritySettingsController::class, 'updateAlerts'])
        ->name('security-settings.alerts');

    Route::post('/security-settings/password', [SecuritySettingsController::class, 'setPassword'])
        ->name('security-settings.password.set');

    Route::delete('/security-settings/sessions/{session}', [SecuritySettingsController::class, 'revokeSession'])
        ->name('security-settings.sessions.revoke');

    Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
    Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');

    // One settings home: the Account settings rail. The old Settings menu
    // is gone; its sections live in that rail.
    Route::redirect('/settings', '/account-settings');

    Route::get('/me', [MeController::class, 'show'])->name('me');
    Route::post('/me/authenticator-nudge', [AuthenticatorNudgeController::class, 'shown'])
        ->name('me.authenticator-nudge');
    Route::get('/me/profile', [MeController::class, 'profile'])->name('me.profile');
    Route::post('/me/avatar', [MeController::class, 'updateAvatar'])->name('me.avatar');
    Route::get('/me/preferences', [PreferencesController::class, 'show'])->name('me.preferences');
    Route::put('/me/preferences', [PreferencesController::class, 'update'])->name('me.preferences.update');
    Route::get('/me/sync-status', [MeSyncStatusController::class, 'show'])->name('me.sync-status');
    Route::post('/me/onedrive/pause', [MeOneDriveController::class, 'pause'])->name('me.onedrive.pause');
    Route::post('/me/onedrive/resume', [MeOneDriveController::class, 'resume'])->name('me.onedrive.resume');

    Route::prefix('me/availability')->name('me.availability.')->group(function () {
        Route::get('/', [AvailabilityController::class, 'show'])->name('show');
        Route::put('/status', [AvailabilityController::class, 'updateStatus'])->name('status');
        Route::delete('/status', [AvailabilityController::class, 'clearStatus'])->name('status.clear');
        Route::put('/message', [AvailabilityController::class, 'updateMessage'])->name('message');
        Route::post('/location', [AvailabilityController::class, 'reportLocation'])->name('location.report');
        Route::get('/geocode', [AvailabilityController::class, 'geocode'])->name('geocode');
        Route::get('/reverse-geocode', [AvailabilityController::class, 'reverseGeocode'])->name('reverse-geocode');
        Route::put('/locations', [AvailabilityController::class, 'upsertLocation'])->name('locations.upsert');
        Route::delete('/locations/{type}', [AvailabilityController::class, 'deleteLocation'])->name('locations.delete');
        Route::post('/schedules', [AvailabilityController::class, 'storeSchedule'])->name('schedules.store');
        Route::delete('/schedules/{id}', [AvailabilityController::class, 'destroySchedule'])->name('schedules.destroy');
        Route::post('/call', [AvailabilityController::class, 'reportCall'])->name('call');
    });

    // Notifications: the bell popup, the right-sidebar section, and the badge.
    Route::prefix('portal/notifications')->name('notifications.')->group(function () {
        Route::get('/', [NotificationController::class, 'index'])->name('index');
        Route::get('/count', [NotificationController::class, 'count'])->name('count');
        Route::get('/preferences', [NotificationController::class, 'preferences'])->name('preferences');
        Route::put('/preferences', [NotificationController::class, 'updatePreferences'])->name('preferences.update');
        Route::post('/read-all', [NotificationController::class, 'readAll'])->name('read-all');
        Route::post('/bulk', [NotificationController::class, 'bulk'])->name('bulk');
        Route::post('/{uid}/read', [NotificationController::class, 'read'])->name('read');
        Route::post('/{uid}/unread', [NotificationController::class, 'unread'])->name('unread');
        Route::post('/{uid}/complete', [NotificationController::class, 'complete'])->name('complete');
        Route::delete('/{uid}', [NotificationController::class, 'destroy'])->name('destroy');
    });

    // Activity trail: Overview → Activity, the right-sidebar section, the popup.
    Route::prefix('portal/activity')->name('activity.')->group(function () {
        Route::get('/', [ActivityController::class, 'index'])->name('index');
        Route::get('/count', [ActivityController::class, 'count'])->name('count');
        Route::get('/filters', [ActivityController::class, 'filters'])->name('filters');
        Route::post('/seen', [ActivityController::class, 'markSeen'])->name('seen');
    });

    Route::prefix('portal/admin/recycle-bin')->name('admin.recycle-bin.')->group(function () {
        Route::get('/', [AdminRecycleBinController::class, 'index'])->name('index');
        Route::post('/empty', [AdminRecycleBinController::class, 'empty'])->name('empty');
        Route::post('/{kind}/{id}/restore', [AdminRecycleBinController::class, 'restore'])->name('restore');
        Route::delete('/{kind}/{id}', [AdminRecycleBinController::class, 'purge'])->name('purge');
    });

    Route::get('/admin/users', [AdminUsersController::class, 'index'])->name('admin.users');
    Route::get('/admin/users/pending-count', [AdminUsersController::class, 'pendingCount'])->name('admin.users.pending-count');
    Route::post('/admin/users', [AdminUsersController::class, 'store'])->name('admin.users.store');
    Route::post('/admin/users/bulk-delete', [AdminUsersController::class, 'bulkDestroy'])->name('admin.users.bulk-delete');
    Route::patch('/admin/users/{user}', [AdminUsersController::class, 'update'])->name('admin.users.update');
    Route::delete('/admin/users/{user}', [AdminUsersController::class, 'destroy'])->name('admin.users.destroy');
    Route::get('/admin/users/{user}/activity', [AdminUsersController::class, 'activity'])->name('admin.users.activity');
    Route::post('/admin/users/{user}/send-reset', [AdminUsersController::class, 'sendReset'])->name('admin.users.send-reset');
    Route::post('/admin/users/{user}/generate-password', [AdminUsersController::class, 'generatePassword'])->name('admin.users.generate-password');
    Route::post('/admin/users/{user}/reset-two-factor', [AdminUsersController::class, 'resetTwoFactor'])->name('admin.users.reset-two-factor');
    Route::post('/admin/users/{user}/approve', [AdminUsersController::class, 'approve'])->name('admin.users.approve');
    Route::post('/admin/users/{user}/deny', [AdminUsersController::class, 'deny'])->name('admin.users.deny');
    Route::post('/admin/users/{user}/suspend', [AdminUsersController::class, 'suspend'])->name('admin.users.suspend');
    Route::post('/admin/users/{user}/reactivate', [AdminUsersController::class, 'reactivate'])->name('admin.users.reactivate');

    /*
     * The People section. Reading the directory is staff-wide; the writes it
     * offers (create, edit, delete an account) are AdminUsersController's
     * above, so the rules for those live in exactly one place.
     */
    Route::prefix('portal/people')->name('people.')->group(function () {
        Route::get('/summary', [PeopleController::class, 'summary'])->name('summary');
        Route::get('/employees', [PeopleController::class, 'employees'])->name('employees');
        Route::get('/client-contacts', [PeopleController::class, 'clientContacts'])->name('client-contacts');
        Route::get('/prospects', [PeopleController::class, 'prospects'])->name('prospects');
        Route::delete('/prospects/{ref}', [PeopleController::class, 'destroyProspect'])
            ->where('ref', '(invite|user):[0-9]+')->name('prospects.destroy');
        Route::get('/welcome-candidates', [PeopleController::class, 'welcomeCandidates'])->name('welcome-candidates');
        Route::post('/welcome', [PeopleController::class, 'sendWelcome'])->name('welcome');
    });

    // People → Shared / Personal address book.
    Route::prefix('portal/contacts')->name('contacts.')->group(function () {
        Route::get('/', [ContactsController::class, 'index'])->name('index');
        Route::post('/', [ContactsController::class, 'store'])->name('store');
        // Literal path before the {uuid} wildcard so it can't swallow it.
        Route::post('/bulk-delete', [ContactsController::class, 'bulkDestroy'])->name('bulk-delete');
        Route::patch('/{uuid}', [ContactsController::class, 'update'])->name('update');
        Route::delete('/{uuid}', [ContactsController::class, 'destroy'])->name('destroy');
    });

    Route::get('/admin/connectors', [ConnectorsController::class, 'index'])->name('admin.connectors');

    // Settings → Background Operations: the real queue.
    Route::get('/admin/background-ops', [BackgroundOperationsController::class, 'index'])->name('admin.background-ops');
    Route::post('/admin/background-ops/retry', [BackgroundOperationsController::class, 'retry'])->name('admin.background-ops.retry');
    Route::post('/admin/background-ops/flush', [BackgroundOperationsController::class, 'flush'])->name('admin.background-ops.flush');
    Route::put('/admin/background-ops/imports-pause', [BackgroundOperationsController::class, 'pauseImports'])->name('admin.background-ops.imports-pause');
    Route::post('/admin/background-ops/imports-run', [BackgroundOperationsController::class, 'runImport'])->name('admin.background-ops.imports-run');
    Route::post('/admin/background-ops/libraries', [BackgroundOperationsController::class, 'connectLibrary'])->name('admin.background-ops.libraries');

    // Settings → Client hub management → Client hub access: the firm-wide
    // shape of the hub. Reading needs `settings.clientHub`; writing needs an
    // administrator, both re-checked in the controller.
    Route::get('/admin/client-hub', [ClientHubSettingsController::class, 'show'])
        ->name('admin.client-hub');
    Route::put('/admin/client-hub', [ClientHubSettingsController::class, 'update'])
        ->name('admin.client-hub.update');

    // Settings → Advanced Preferences → Permissions: the firm-wide sharing and
    // visibility defaults. Same split as the client hub above — reading needs
    // `settings.advanced`, writing needs an administrator.
    Route::get('/admin/permissions', [PortalPermissionsController::class, 'show'])
        ->name('admin.permissions');
    Route::put('/admin/permissions', [PortalPermissionsController::class, 'update'])
        ->name('admin.permissions.update');

    // Settings → Client hub management → Service teams. Teams themselves are
    // groups (People → Groups); this only puts one onto a client, or takes it
    // off, fanning out into ordinary per-person assignments.
    Route::get('/admin/service-teams', [ServiceTeamsController::class, 'index'])
        ->name('admin.service-teams');
    Route::post('/admin/service-teams/{id}/assign', [ServiceTeamsController::class, 'assign'])
        ->name('admin.service-teams.assign');
    Route::post('/admin/service-teams/{id}/unassign', [ServiceTeamsController::class, 'unassign'])
        ->name('admin.service-teams.unassign');

    // Settings → Client hub management → Custom fields. Defines them; the
    // values are collected on the client record and normalised on every write
    // by ClientCustomFields::sanitise().
    Route::get('/admin/client-fields', [ClientCustomFieldsController::class, 'index'])
        ->name('admin.client-fields');
    Route::post('/admin/client-fields', [ClientCustomFieldsController::class, 'store'])
        ->name('admin.client-fields.store');
    Route::put('/admin/client-fields/{id}', [ClientCustomFieldsController::class, 'update'])
        ->name('admin.client-fields.update');
    Route::delete('/admin/client-fields/{id}', [ClientCustomFieldsController::class, 'destroy'])
        ->name('admin.client-fields.destroy');

    /*
     * CIP applications. The intake wizard asks for its own options rather
     * than hard-coding a country list in the browser, so the region a
     * country implies is decided in one place. Gated by CipAccess, which
     * answers for external applicants too — they hold no capability.
     */
    Route::prefix('portal/cip')->name('cip.')->group(function () {
        Route::get('/applications/form', [CipApplicationController::class, 'form'])->name('applications.form');
        // Above `/applications/{uuid}`, or the wildcard swallows it and the
        // catch-up read becomes a lookup for an application called "sync".
        Route::get('/applications/sync', [CipApplicationController::class, 'sync'])->name('applications.sync');
        Route::get('/applications', [CipApplicationController::class, 'index'])->name('applications.index');
        Route::post('/applications', [CipApplicationController::class, 'store'])->name('applications.store');
        Route::get('/applications/{uuid}', [CipApplicationController::class, 'show'])->name('applications.show');
        Route::get('/applications/{uuid}/messages', [CipThreadController::class, 'index'])
            ->name('applications.messages.index');
        Route::post('/applications/{uuid}/messages', [CipThreadController::class, 'store'])
            ->name('applications.messages.store');
        // Multipart carries the files, and PHP only parses a body for POST —
        // so the update is posted with _method, the way every other form in
        // the portal that sends files does it.
        Route::post('/applications/{uuid}', [CipApplicationController::class, 'update'])->name('applications.update');
        Route::post('/applications/{uuid}/post-approval', [CipApplicationController::class, 'enterPostApproval'])
            ->name('applications.post-approval');
        /*
         * §9: the buckets a reader opens their day on, counted.
         *
         * Deliberately uncached — see App\Support\Cip\Buckets. A work queue
         * that lags a status change by five minutes reads as broken.
         */
        Route::get('/dashboard', CipDashboardController::class)->name('dashboard');

        /*
         * §6: the application moves.
         *
         * One endpoint for every edge, because the lifecycle is one machine —
         * Engine refuses an edge that is not in its map and an actor without
         * the capability for it, so there is no gate here beyond reach.
         */
        Route::post('/applications/{uuid}/status', [CipTransitionController::class, 'update'])
            ->name('applications.status');
        /*
         * Draft → New, the provider side filing its own work.
         *
         * Its own verb because it carries a precondition the generic endpoint
         * cannot: a draft whose main applicant still owes required documents
         * is not something anybody can assess.
         *
         * Named submit-draft, not submit: `applications.submit` is already the
         * Unit submission below, and two routes of one name means one of them
         * silently wins.
         */
        Route::post('/applications/{uuid}/submit', [CipTransitionController::class, 'submit'])
            ->name('applications.submit-draft');
        /*
         * §15: the service provider confirms, and the original package freezes.
         *
         * Not a status change — Ready to submit is reached automatically —
         * so it cannot ride the generic status route. Staff record the CIP
         * number afterwards through applications.submit.
         */
        Route::post('/applications/{uuid}/confirm', [CipTransitionController::class, 'confirm'])
            ->name('applications.confirm');
        /*
         * §21: the Unit decided. Its own verb because it writes `decision`
         * and `decided_at` — a bare status change would leave both null on a
         * terminal file, and there is no edge back to fill them.
         */
        Route::post('/applications/{uuid}/decision', [CipTransitionController::class, 'decide'])
            ->name('applications.decision');
        /*
         * §18: the Unit asked for more. Its own verb because it writes
         * `query_received_at` and then moves the file to Non-compliant — a
         * bare status change would leave the date empty.
         */
        Route::post('/applications/{uuid}/query', [CipTransitionController::class, 'query'])
            ->name('applications.query');
        /*
         * §19: the Unit accepted the file. Its own verb because it writes
         * `accepted_at` and then moves the file to Background check — a
         * bare status change would leave the delay clock with no start.
         */
        Route::post('/applications/{uuid}/acceptance', [CipTransitionController::class, 'accept'])
            ->name('applications.acceptance');
        /*
         * Brief §6–§12: a post-approval date, then the status that date
         * moves the file to. The generic status route refuses those targets
         * so a bare move cannot leave the day empty.
         */
        Route::post('/applications/{uuid}/stage', [CipTransitionController::class, 'stage'])
            ->name('applications.stage');

        /*
         * §10: who is working on this application.
         *
         * Assignment is what starts a review — the first one drives NEW into
         * Review application — so it is a write of its own rather than a
         * transition somebody drives by hand.
         */
        /*
         * §4d: the Activity tab — one application's history, as sentences.
         *
         * Its own segment rather than a query on the application, because it
         * is a different read with a different size: a profile wants the
         * record, this wants five hundred rows of what happened to it.
         */
        Route::get('/applications/{uuid}/events', [CipEventController::class, 'index'])
            ->name('applications.events');

        Route::get('/applications/{uuid}/assignments', [CipAssignmentController::class, 'index'])
            ->name('applications.assignments.index');
        Route::post('/applications/{uuid}/assignments', [CipAssignmentController::class, 'store'])
            ->name('applications.assignments.store');
        Route::delete('/applications/{uuid}/assignments/{userId}', [CipAssignmentController::class, 'destroy'])
            ->name('applications.assignments.destroy');

        /*
         * §12: judging one document.
         *
         * Addressed by the document, because the brief is explicit that a
         * reviewer works the checklist where it is drawn and never by going to
         * the File Library for it.
         */
        Route::post('/documents/{uuid}/approve', [CipReviewController::class, 'approve'])
            ->name('documents.approve');
        Route::post('/documents/{uuid}/request-changes', [CipReviewController::class, 'requestChanges'])
            ->name('documents.request-changes');
        /*
         * Filing one checklist slot from the application page. Post-approval
         * files cannot use Edit application once the original package is
         * locked, so this is the door the person Documents list uses.
         */
        Route::post('/documents/{uuid}/file', [CipDocumentUploadController::class, 'store'])
            ->name('documents.file');

        /*
         * §11: the document requirements the checklists are built from.
         *
         * Readable by anyone who may reach the module — the checklist needs
         * the labels — and changeable only by an administrator, because one
         * edit reaches every application at once.
         */
        Route::get('/requirements', [CipRequirementController::class, 'index'])->name('requirements.index');
        Route::post('/requirements', [CipRequirementController::class, 'store'])->name('requirements.store');
        Route::post('/requirements/reorder', [CipRequirementController::class, 'reorder'])
            ->name('requirements.reorder');
        Route::patch('/requirements/{uuid}', [CipRequirementController::class, 'update'])
            ->name('requirements.update');
        Route::delete('/requirements/{uuid}', [CipRequirementController::class, 'destroy'])
            ->name('requirements.destroy');
        Route::post('/requirements/{uuid}/restore', [CipRequirementController::class, 'restore'])
            ->name('requirements.restore');

        /*
         * §23: Granted and Denied letters, one pair per investment type.
         *
         * Readable by anyone who may reach the module; changeable only with
         * cip.configure, because one edit is every future decision letter.
         */
        Route::get('/letters', [CipLetterController::class, 'index'])->name('letters.index');
        Route::patch('/letters/{uuid}', [CipLetterController::class, 'update'])->name('letters.update');
        Route::post('/letters/{uuid}/restore', [CipLetterController::class, 'restore'])
            ->name('letters.restore');

        /*
         * §22: the CIP Distribution Group. Membership is edited on People →
         * Distribution groups; extra mailboxes that are not portal accounts
         * are kept here.
         */
        Route::get('/distribution', [CipDistributionController::class, 'show'])
            ->name('distribution.show');
        Route::patch('/distribution', [CipDistributionController::class, 'update'])
            ->name('distribution.update');

        /*
         * §13: the conversation on one checklist document.
         *
         * Addressed by the document, not by the file in it — the slot outlives
         * its file, and an empty requirement is the one most worth talking
         * about.
         */
        Route::get('/documents/{uuid}/comments', [CipDocumentCommentController::class, 'index'])
            ->name('documents.comments.index');
        Route::post('/documents/{uuid}/comments', [CipDocumentCommentController::class, 'store'])
            ->name('documents.comments.store');
        Route::patch('/documents/{uuid}/comments/{commentUuid}', [CipDocumentCommentController::class, 'update'])
            ->name('documents.comments.update');
        Route::delete('/documents/{uuid}/comments/{commentUuid}', [CipDocumentCommentController::class, 'destroy'])
            ->name('documents.comments.destroy');
        Route::post('/documents/{uuid}/comments/{commentUuid}/resolve', [CipDocumentCommentController::class, 'resolve'])
            ->name('documents.comments.resolve');

        // §7/§16: the Unit has it — record the date and the CIP number, which
        // is also what switches every surface off the internal number.
        Route::post('/applications/{uuid}/submission', [CipApplicationController::class, 'submit'])
            ->name('applications.submit');
        // A mistyped government number, corrected without unwinding the status.
        Route::patch('/applications/{uuid}/cip-number', [CipApplicationController::class, 'correctNumber'])
            ->name('applications.cip-number');
        /*
         * §4d: a day on the Timeline card recorded wrong, corrected in place.
         *
         * A correction, not a transition, so it does not belong on the status
         * routes above: the file has already been where the date says, and
         * only the record of when moves. App\Support\Cip\Milestones refuses a
         * step with no date yet, which is what keeps this from being a second
         * door into the lifecycle.
         */
        Route::patch('/applications/{uuid}/milestones/{key}', [CipApplicationController::class, 'correctMilestone'])
            ->name('applications.milestone');
        // Which application a client's profile is showing, or none yet.
        Route::get('/clients/{uid}/application', [CipApplicationController::class, 'forClient'])->name('clients.application');
        // The archival passport photo, streamed through the app: it is a
        // likeness on a private bucket, reachable only by a reader who may
        // already open the application it belongs to.
        Route::get('/people/{uuid}/passport-photo', [CipApplicationController::class, 'passportPhoto'])
            ->name('people.passport-photo');
        Route::post('/people/{uuid}/status', [CipPersonStatusController::class, 'update'])
            ->name('people.status');
    });

    Route::get('/admin/security-policies', [AdminSecurityController::class, 'show'])
        ->name('admin.security-policies');

    Route::put('/admin/security-policies/{section}', [AdminSecurityController::class, 'update'])
        ->name('admin.security-policies.update');

    // Settings → Storage → Usage: bytes measured from the tables that hold
    // them, not only the File Library.
    Route::get('/admin/storage-usage', [StorageUsageController::class, 'index'])
        ->name('admin.storage-usage');

    /*
     * Settings → Account and Reporting.
     *
     * Reports are computed from the portal's own tables (ReportBuilder), the
     * notification history reads `email_deliveries`, and branding is stored
     * once for the whole firm. All three are gated in their controllers.
     */
    Route::prefix('admin/reports')->name('admin.reports.')->group(function () {
        Route::get('/', [ReportsController::class, 'index'])->name('index');
        Route::post('/', [ReportsController::class, 'store'])->name('store');
        Route::get('/{uid}', [ReportsController::class, 'show'])->name('show');
        Route::get('/{uid}/export', [ReportsController::class, 'export'])->name('export');
        Route::post('/{uid}/run', [ReportsController::class, 'run'])->name('run');
        Route::delete('/{uid}', [ReportsController::class, 'destroy'])->name('destroy');
    });

    Route::get('/admin/notification-history', [NotificationHistoryController::class, 'index'])
        ->name('admin.notification-history');

    Route::prefix('admin/branding')->name('admin.branding.')->group(function () {
        // Readable by any signed-in account: the firm's name, title and
        // colours are chrome every shell paints. The writes below are not.
        Route::get('/', [BrandingController::class, 'show'])->name('show');
        Route::put('/', [BrandingController::class, 'update'])->name('update');
        Route::post('/logo', [BrandingController::class, 'uploadLogo'])->name('logo.store');
        Route::delete('/logo', [BrandingController::class, 'destroyLogo'])->name('logo.destroy');
        Route::post('/reset', [BrandingController::class, 'reset'])->name('reset');
    });

    /*
     * File & folder manager API. Everything is authorized server-side in the
     * controllers (FileAccess) — the client's hidden buttons are never trusted.
     * Files/folders are addressed by public uuid; storage paths are never exposed.
     */
    Route::prefix('portal/files')->name('files.')->group(function () {
        Route::get('/', [BrowserController::class, 'index'])->name('browse');
        // What changed since a device last looked — the offline catch-up read.
        Route::get('/sync', [FilesSyncController::class, 'index'])->name('sync');

        Route::post('/folders', [FolderController::class, 'store'])->name('folders.store');
        Route::get('/folders/{uuid}', [FolderController::class, 'show'])->name('folders.show');
        Route::patch('/folders/{uuid}', [FolderController::class, 'update'])->name('folders.update');
        Route::patch('/folders/{uuid}/colour', [FolderController::class, 'colour'])->name('folders.colour');
        Route::patch('/folders/{uuid}/icon', [FolderController::class, 'icon'])->name('folders.icon');
        Route::post('/folders/{uuid}/move', [FolderController::class, 'move'])->name('folders.move');
        Route::post('/folders/{uuid}/copy', [FolderController::class, 'copy'])->name('folders.copy');
        Route::delete('/folders/{uuid}', [FolderController::class, 'destroy'])->name('folders.destroy');
        Route::post('/folders/{uuid}/restore', [FolderController::class, 'restore'])->name('folders.restore');
        Route::delete('/folders/{uuid}/force', [FolderController::class, 'forceDelete'])->name('folders.force');
        Route::get('/folders/{uuid}/download', [FolderController::class, 'download'])->name('folders.download');

        Route::post('/files', [FileController::class, 'store'])->name('store');
        Route::get('/files/{uuid}', [FileController::class, 'show'])->name('show');
        Route::patch('/files/{uuid}', [FileController::class, 'update'])->name('update');
        Route::patch('/files/{uuid}/review', [FileReviewController::class, 'update'])->name('review');
        Route::post('/files/{uuid}/move', [FileController::class, 'move'])->name('move');
        Route::post('/files/{uuid}/copy', [FileController::class, 'copy'])->name('copy');
        Route::delete('/files/{uuid}', [FileController::class, 'destroy'])->name('destroy');
        Route::post('/files/{uuid}/restore', [FileController::class, 'restore'])->name('restore');
        Route::delete('/files/{uuid}/force', [FileController::class, 'forceDelete'])->name('force');
        Route::get('/files/{uuid}/download', [FileController::class, 'download'])->name('download');
        Route::get('/files/{uuid}/preview', [FileController::class, 'preview'])->name('preview');
        Route::get('/files/{uuid}/thumb', [ThumbnailController::class, 'show'])->name('thumb');

        // The collaboration viewer's right-hand panel. Split so opening a file
        // never waits on history or a firm-wide access roll-up.
        Route::get('/files/{uuid}/activity', [FileViewerController::class, 'activity'])->name('activity');
        Route::get('/files/{uuid}/access', [FileViewerController::class, 'access'])->name('access');
        Route::get('/files/{uuid}/details', [FileViewerController::class, 'details'])->name('details');

        // Comment threads. A comment is always addressed within its file, so a
        // uuid from one file can never reach another's thread.
        Route::get('/files/{uuid}/comments', [FileCommentController::class, 'index'])->name('comments.index');
        Route::get('/files/{uuid}/mentionable', [FileCommentController::class, 'mentionable'])->name('comments.mentionable');
        Route::post('/files/{uuid}/comments', [FileCommentController::class, 'store'])->name('comments.store');
        Route::patch('/files/{uuid}/comments/{comment}', [FileCommentController::class, 'update'])->name('comments.update');
        Route::delete('/files/{uuid}/comments/{comment}', [FileCommentController::class, 'destroy'])->name('comments.destroy');
        Route::post('/files/{uuid}/comments/{comment}/resolve', [FileCommentController::class, 'resolve'])->name('comments.resolve');

        // Version history. Nothing under here deletes stored bytes: uploading
        // a version appends, and restoring appends too.
        Route::get('/files/{uuid}/versions', [FileVersionController::class, 'index'])->name('versions.index');
        Route::post('/files/{uuid}/versions', [FileVersionController::class, 'store'])->name('versions.store');
        Route::patch('/files/{uuid}/versions/{version}', [FileVersionController::class, 'update'])->name('versions.update');
        Route::get('/files/{uuid}/versions/{version}/download', [FileVersionController::class, 'download'])->name('versions.download');
        Route::get('/files/{uuid}/versions/{version}/preview', [FileVersionController::class, 'preview'])->name('versions.preview');
        Route::post('/files/{uuid}/versions/{version}/restore', [FileVersionController::class, 'restore'])->name('versions.restore');

        /*
         * The Workflows section: requests and discussion gathered across every
         * file, rather than one file at a time. Read-only — the client acts
         * through the per-file endpoints below, which is where the permission
         * checks already live.
         */
        Route::get('/workflows', [WorkflowHubController::class, 'index'])->name('workflows.hub');
        Route::get('/workflows/comments', [WorkflowHubController::class, 'comments'])->name('workflows.hub.comments');
        Route::get('/workflows/updates', [WorkflowHubController::class, 'updates'])->name('workflows.hub.updates');
        Route::get('/workflows/counts', [WorkflowHubController::class, 'counts'])->name('workflows.hub.counts');
        // Opening a comment from the Workflows page is the reading; the listing
        // itself is not, so it says so here.
        Route::post('/workflows/comments/{comment}/read', [WorkflowHubController::class, 'read'])
            ->name('workflows.hub.read');

        // Review / approval / acknowledgement requests. A request is pinned to
        // the version it was sent on and never silently follows the file.
        Route::get('/files/{uuid}/workflows', [FileWorkflowController::class, 'index'])->name('workflows.index');
        Route::post('/files/{uuid}/workflows', [FileWorkflowController::class, 'store'])->name('workflows.store');
        Route::post('/files/{uuid}/workflows/{workflow}/respond', [FileWorkflowController::class, 'respond'])->name('workflows.respond');
        Route::post('/files/{uuid}/workflows/{workflow}/cancel', [FileWorkflowController::class, 'cancel'])->name('workflows.cancel');
        Route::post('/files/{uuid}/workflows/{workflow}/delegate', [FileWorkflowController::class, 'delegate'])->name('workflows.delegate');
        Route::get('/files/{uuid}/workflows/{workflow}/history', [FileWorkflowController::class, 'history'])->name('workflows.history');

        // Active viewers. Presence is a heartbeat, never an inference from
        // past activity — see App\Support\Files\Presence.
        Route::get('/files/{uuid}/presence', [FilePresenceController::class, 'index'])->name('presence.index');
        Route::post('/files/{uuid}/presence', [FilePresenceController::class, 'store'])->name('presence.store');
        Route::delete('/files/{uuid}/presence', [FilePresenceController::class, 'destroy'])->name('presence.destroy');

        Route::post('/uploads', [UploadController::class, 'init'])->name('uploads.init');
        Route::post('/uploads/{uuid}/chunk', [UploadController::class, 'chunk'])->name('uploads.chunk');
        Route::get('/uploads/{uuid}/status', [UploadController::class, 'status'])->name('uploads.status');
        Route::post('/uploads/{uuid}/complete', [UploadController::class, 'complete'])->name('uploads.complete');
        Route::delete('/uploads/{uuid}', [UploadController::class, 'abort'])->name('uploads.abort');

        // Library sync state, so "where are my files?" has a visible answer.
        Route::get('/sync-status', SyncStatusController::class)->name('sync-status');
        Route::post('/sync-status/retry', [SyncStatusController::class, 'retry'])->name('sync-status.retry');
        Route::post('/sync-status/pull', [SyncStatusController::class, 'pull'])->name('sync-status.pull');

        Route::get('/shortcuts', [ShortcutController::class, 'index'])->name('shortcuts.index');
        Route::post('/shortcuts', [ShortcutController::class, 'store'])->name('shortcuts.store');
        Route::put('/shortcuts/reorder', [ShortcutController::class, 'reorder'])->name('shortcuts.reorder');
        Route::delete('/shortcuts/{uuid}', [ShortcutController::class, 'destroy'])->name('shortcuts.destroy');

        Route::post('/favorites/toggle', [FavoriteController::class, 'toggle'])->name('favorites.toggle');
        Route::post('/recycle-bin/empty', [RecycleBinController::class, 'empty'])->name('recycle.empty');
        Route::post('/bulk', [BulkController::class, 'handle'])->name('bulk');

        /*
         * Document requests — the issuing half of Request Files. The link
         * itself is served publicly at /r/{token}; nothing here exposes a
         * token to anyone but the person who created the request.
         */
        Route::get('/requests', [FileRequestController::class, 'index'])->name('requests.index');
        Route::post('/requests', [FileRequestController::class, 'store'])->name('requests.store');
        Route::get('/requests/{uuid}', [FileRequestController::class, 'show'])->name('requests.show');
        Route::patch('/requests/{uuid}', [FileRequestController::class, 'update'])->name('requests.update');
        Route::delete('/requests/{uuid}', [FileRequestController::class, 'destroy'])->name('requests.destroy');
        Route::post('/requests/{uuid}/send', [FileRequestController::class, 'send'])->name('requests.send');

        Route::get('/shares', [ShareController::class, 'index'])->name('shares.index');
        // Who an item can be assigned to, for the row menu's picker.
        Route::get('/shares/people', [ShareController::class, 'people'])->name('shares.people');
        Route::post('/shares', [ShareController::class, 'store'])->name('shares.store');
        Route::patch('/shares/{uuid}', [ShareController::class, 'update'])->name('shares.update');
        Route::delete('/shares/{uuid}', [ShareController::class, 'destroy'])->name('shares.destroy');
    });

    /*
     * Signature requests API. Addressed by public uuid; ownership and the
     * status rules are re-checked in the controller on every action. Signing
     * tokens are never returned here — they only exist in a recipient's link.
     */
    Route::prefix('portal/signatures')->name('signatures.')->group(function () {
        Route::get('/', [SignatureRequestController::class, 'index'])->name('index');
        Route::get('/documents', [SignatureRequestController::class, 'documents'])->name('documents');
        Route::get('/people', [SignatureRequestController::class, 'people'])->name('people');
        Route::post('/', [SignatureRequestController::class, 'store'])->name('store');
        Route::get('/{uuid}', [SignatureRequestController::class, 'show'])->name('show');
        Route::patch('/{uuid}', [SignatureRequestController::class, 'update'])->name('update');
        Route::delete('/{uuid}', [SignatureRequestController::class, 'destroy'])->name('destroy');
        Route::post('/{uuid}/cancel', [SignatureRequestController::class, 'cancel'])->name('cancel');
        Route::post('/{uuid}/send', [SignatureRequestController::class, 'send'])->name('send');
        Route::post('/{uuid}/remind', [SignatureRequestController::class, 'remind'])->name('remind');
        Route::get('/{uuid}/links', [SignatureRequestController::class, 'links'])->name('links');

        // The editor: the document itself, and the fields placed on it.
        Route::get('/{uuid}/document', [SignatureFieldController::class, 'document'])->name('document');
        Route::get('/{uuid}/fields', [SignatureFieldController::class, 'index'])->name('fields.index');
        Route::put('/{uuid}/fields', [SignatureFieldController::class, 'store'])->name('fields.store');
    });

    /*
     * Client directory API (the "Client hub"). Staff-only, re-checked in the
     * controller. Clients are addressed by their public uid; the full contact
     * record is stored and returned verbatim under `profile`.
     */
    Route::prefix('portal/clients')->name('clients.')->group(function () {
        Route::get('/', [ClientsController::class, 'index'])->name('index');
        Route::post('/', [ClientsController::class, 'store'])->name('store');
        Route::post('/bulk-delete', [ClientsController::class, 'bulkDestroy'])->name('bulk-delete');
        // Literal paths before /{uid} so they aren't swallowed by the wildcard.
        Route::get('/assigned-to-me', [ClientAssignmentController::class, 'mine'])->name('assigned-to-me');
        // What changed since a device last looked — the offline catch-up read.
        Route::get('/sync', [ClientsController::class, 'sync'])->name('sync');
        // Short slice for the right sidebar — never the full directory.
        Route::get('/preview', [ClientsController::class, 'preview'])->name('preview');
        // Searching reaches into the profile blob the listing no longer sends.
        Route::get('/search', [ClientsController::class, 'search'])->name('search');
        Route::get('/{uid}/assignments', [ClientAssignmentController::class, 'index'])->name('assignments.index');
        Route::post('/{uid}/assignments', [ClientAssignmentController::class, 'store'])->name('assignments.store');
        Route::patch('/{uid}/assignments/{userId}', [ClientAssignmentController::class, 'update'])->name('assignments.update');
        Route::post('/{uid}/assignments/{userId}/reassign', [ClientAssignmentController::class, 'reassign'])->name('assignments.reassign');
        Route::delete('/{uid}/assignments/{userId}', [ClientAssignmentController::class, 'destroy'])->name('assignments.destroy');
        Route::get('/{uid}', [ClientsController::class, 'show'])->name('show');
        Route::patch('/{uid}', [ClientsController::class, 'update'])->name('update');
        Route::delete('/{uid}', [ClientsController::class, 'destroy'])->name('destroy');
        Route::post('/{uid}/duplicate', [ClientsController::class, 'duplicate'])->name('duplicate');
        // Invite a client (with no login) to create a portal account.
        Route::post('/{uid}/invite', [ClientInviteController::class, 'send'])->name('invite');
        Route::get('/{uid}/invite', [ClientInviteController::class, 'status'])->name('invite.status');
        // The Portal access tab: invitation, or the account's logins and activity.
        Route::get('/{uid}/access', [ClientInviteController::class, 'access'])->name('access');
        Route::get('/{uid}/conversations', [ClientConversationController::class, 'index'])->name('conversations.index');
        Route::post('/{uid}/conversations', [ClientConversationController::class, 'store'])->name('conversations.store');
    });

    /*
     * Invitation management: every outstanding, accepted, expired, failed and
     * cancelled invitation, with the actions staff need to chase them.
     */
    Route::prefix('portal/invitations')->name('invitations.')->group(function () {
        Route::get('/', [InvitationController::class, 'index'])->name('index');
        Route::post('/', [InvitationController::class, 'store'])->name('store');
        Route::get('/{uuid}', [InvitationController::class, 'show'])->name('show');
        Route::post('/{uuid}/resend', [InvitationController::class, 'resend'])->name('resend');
        Route::post('/{uuid}/link', [InvitationController::class, 'link'])->name('link');
        Route::post('/{uuid}/cancel', [InvitationController::class, 'cancel'])->name('cancel');
        Route::patch('/{uuid}/recipient', [InvitationController::class, 'updateRecipient'])->name('recipient');
        Route::delete('/{uuid}', [InvitationController::class, 'destroy'])->name('destroy');
    });

    Route::prefix('portal/companies')->name('companies.')->group(function () {
        Route::get('/', [CompaniesController::class, 'index'])->name('index');
        Route::post('/', [CompaniesController::class, 'store'])->name('store');
        Route::get('/{uid}', [CompaniesController::class, 'show'])->name('show');
        Route::patch('/{uid}', [CompaniesController::class, 'update'])->name('update');
        Route::delete('/{uid}', [CompaniesController::class, 'destroy'])->name('destroy');

        // The people at the company who may reach its records.
        Route::get('/{uid}/members', [CompanyMemberController::class, 'index'])->name('members.index');
        Route::post('/{uid}/members', [CompanyMemberController::class, 'store'])->name('members.store');
        Route::post('/{uid}/members/{member}/invite', [CompanyMemberController::class, 'invite'])->name('members.invite');
        Route::patch('/{uid}/members/{member}', [CompanyMemberController::class, 'update'])->name('members.update');
        Route::delete('/{uid}/members/{member}', [CompanyMemberController::class, 'destroy'])->name('members.destroy');

        // The firm's own staff looking after the company.
        Route::get('/{uid}/staff', [CompanyStaffController::class, 'index'])->name('staff.index');
        // What an assignment would cover, before it is made.
        Route::post('/{uid}/staff/preview', [CompanyStaffController::class, 'preview'])->name('staff.preview');
        Route::post('/{uid}/staff', [CompanyStaffController::class, 'store'])->name('staff.store');
        Route::delete('/{uid}/staff/{userId}', [CompanyStaffController::class, 'destroy'])->name('staff.destroy');
    });

    /*
     * Mailbox API. Backed by the user's connected Google or Microsoft account
     * (see App\Support\Mail). Messages are addressed by uuid; every write hits
     * the provider first and is mirrored locally only once it succeeds.
     *
     * Staff only: clients correspond through Messages, and nothing here was
     * stopping a client who connected Gmail from running a full mailbox
     * inside the portal.
     */
    /*
     * Templates APIs. System emails stay administrators-only. Compose email
     * templates are for anyone with templates.email (staff), who manage their
     * own rows; administrators can also publish firm defaults.
     */
    Route::prefix('portal/templates')->name('templates.')->group(function () {
        Route::middleware('capability:templates.view')->group(function () {
            Route::get('/system-emails', [TemplatesController::class, 'index'])->name('system.index');
            Route::patch('/system-emails/{key}', [TemplatesController::class, 'update'])->name('system.update');
            Route::post('/system-emails/{key}/restore', [TemplatesController::class, 'restore'])->name('system.restore');
            Route::post('/system-emails/{key}/preview', [TemplatesController::class, 'preview'])->name('system.preview');
        });

        Route::middleware('capability:templates.email')->group(function () {
            Route::get('/email-templates', [TemplatesController::class, 'emailIndex'])->name('email.index');
            Route::post('/email-templates', [TemplatesController::class, 'emailStore'])->name('email.store');
            Route::post('/email-templates/preview', [TemplatesController::class, 'emailPreview'])->name('email.preview');
            Route::patch('/email-templates/{uuid}', [TemplatesController::class, 'emailUpdate'])->name('email.update');
            Route::delete('/email-templates/{uuid}', [TemplatesController::class, 'emailDestroy'])->name('email.destroy');
        });
    });

    Route::prefix('portal/mail')->middleware('capability:mail.use')->name('mail.')->group(function () {
        Route::get('/', [MailController::class, 'index'])->name('index');
        Route::post('/sync', [MailController::class, 'sync'])->name('sync');
        Route::get('/sync-status', [MailController::class, 'syncStatus'])->name('sync-status');
        Route::post('/sync/retry', [MailController::class, 'retrySync'])->name('sync.retry');
        // Mailbox-only sign-out: stops mail sync without disconnecting the
        // provider account from the portal (that lives in Security settings).
        Route::post('/sign-out', [MailController::class, 'signOut'])->name('sign-out');
        Route::get('/sender-photo/{hash}', [MailController::class, 'senderPhoto'])
            ->where('hash', '[a-f0-9]{64}')->name('sender-photo');

        Route::get('/settings', [MailController::class, 'settings'])->name('settings');
        Route::put('/settings', [MailController::class, 'updateSettings'])->name('settings.update');
        Route::post('/settings/import-signature', [MailController::class, 'importSignature'])
            ->name('settings.import-signature');
        Route::post('/settings/import-signature/apply', [MailController::class, 'applyImportedSignature'])
            ->name('settings.import-signature.apply');

        // Compose templates visible to this mailbox (firm defaults + own).
        Route::get('/templates', [MailController::class, 'composeTemplates'])->name('templates');

        // Literal paths before /{uuid} so the wildcard doesn't swallow them.
        Route::get('/drafts', [MailController::class, 'drafts'])->name('drafts');
        Route::post('/drafts', [MailController::class, 'saveDraft'])->name('drafts.save');
        Route::post('/messages/{uuid}/continue', [MailController::class, 'continueDraft'])->name('messages.continue');
        Route::delete('/drafts/{uuid}', [MailController::class, 'deleteDraft'])->name('drafts.delete');

        // Recipient typeahead for compose To/Cc/Bcc (portal + prior mail).
        Route::get('/suggest', [MailController::class, 'suggest'])->name('suggest');

        Route::post('/send', [MailController::class, 'send'])->name('send');
        Route::post('/bulk', [MailController::class, 'bulk'])->name('bulk');
        Route::post('/hydrate-attachments', [MailController::class, 'hydrateAttachments'])->name('hydrate-attachments');
        Route::get('/attachments/{uuid}', [MailController::class, 'attachment'])->name('attachment');

        // One conversation in its own browser / desktop window, rendered
        // server-side so a double-clicked message is readable immediately.
        Route::get('/window/{uuid}', [MailController::class, 'window'])->name('window');

        Route::get('/messages', [MailController::class, 'messages'])->name('messages');
        // Every message in the conversation the given message belongs to.
        Route::get('/messages/{uuid}/thread', [MailController::class, 'thread'])->name('messages.thread');
        // The same conversation as plain list rows: no provider call, no body
        // hydration. This is what the inbox's expand arrow reads.
        Route::get('/messages/{uuid}/conversation', [MailController::class, 'conversation'])
            ->name('messages.conversation');
        Route::get('/messages/{uuid}', [MailController::class, 'show'])->name('messages.show');
        Route::patch('/messages/{uuid}', [MailController::class, 'update'])->name('messages.update');
        Route::post('/messages/{uuid}/move', [MailController::class, 'move'])->name('messages.move');
        Route::post('/messages/{uuid}/labels', [MailController::class, 'setLabel'])->name('messages.labels');
        Route::delete('/messages/{uuid}', [MailController::class, 'destroy'])->name('messages.destroy');

        // Label management: create, rename/recolour, delete.
        Route::post('/labels', [MailController::class, 'createLabel'])->name('labels.store');
        Route::patch('/labels/{uuid}', [MailController::class, 'updateLabel'])->name('labels.update');
        Route::delete('/labels/{uuid}', [MailController::class, 'deleteLabel'])->name('labels.destroy');
    });

    /*
     * Administrator File Library configuration: default client subfolders,
     * the staff-folder toggle, and organization (shared internal) folders.
     */
    Route::prefix('portal/file-library')->name('file-library.')->group(function () {
        Route::get('/settings', [FileLibraryController::class, 'show'])->name('settings.show');
        Route::put('/settings', [FileLibraryController::class, 'updateSettings'])->name('settings.update');
        Route::post('/organization-folders', [FileLibraryController::class, 'storeOrganizationFolder'])->name('org.store');
        Route::patch('/organization-folders/{uuid}', [FileLibraryController::class, 'updateOrganizationFolder'])->name('org.update');
        Route::post('/adopt-folder', [FileLibraryController::class, 'adoptFolder'])->name('adopt-folder');

        // Folder templates: named sets of subfolders. Managing them needs
        // `files.settings`; applying one also needs write access to the target
        // folder, checked separately in the controller.
        Route::get('/folder-templates', [FileLibraryController::class, 'templates'])->name('templates.index');
        Route::post('/folder-templates', [FileLibraryController::class, 'storeTemplate'])->name('templates.store');
        Route::put('/folder-templates/{id}', [FileLibraryController::class, 'updateTemplate'])->name('templates.update');
        Route::delete('/folder-templates/{id}', [FileLibraryController::class, 'destroyTemplate'])->name('templates.destroy');
        Route::post('/folder-templates/{id}/apply', [FileLibraryController::class, 'applyTemplate'])->name('templates.apply');
    });

    /*
     * Calendar API. Calendars are addressed by uuid and every route resolves
     * permission through App\Support\Calendar\CalendarAccess, so a caller
     * without access gets a 403 rather than a filtered response.
     *
     * Subscriptions are the user's own sidebar list: subscribing adds a
     * calendar to it, and the subscription route toggles show/hide and the
     * personal colour. Neither ever changes the calendar itself.
     */
    Route::prefix('portal/calendar')->name('calendar.')->group(function () {
        Route::get('/calendars', [CalendarController::class, 'index'])->name('calendars.index');
        Route::post('/calendars', [CalendarController::class, 'store'])->name('calendars.store');

        // Literal paths before the {uuid} wildcard so it can't swallow them.
        Route::get('/discover', [CalendarController::class, 'discover'])->name('discover');

        // Free/busy for people and groups. Literal, so it can't be read as an
        // event uuid by the routes below.
        Route::get('/availability', [CalendarEventController::class, 'availability'])->name('availability');

        Route::get('/events', [CalendarEventController::class, 'index'])->name('events.index');
        Route::post('/events', [CalendarEventController::class, 'store'])->name('events.store');
        Route::get('/events/{uuid}', [CalendarEventController::class, 'show'])->name('events.show');
        Route::patch('/events/{uuid}', [CalendarEventController::class, 'update'])->name('events.update');
        Route::delete('/events/{uuid}', [CalendarEventController::class, 'destroy'])->name('events.destroy');
        Route::post('/events/{uuid}/complete', [CalendarEventController::class, 'complete'])->name('events.complete');

        // Guest list and RSVPs. `respond` answers for the signed-in user only.
        Route::post('/events/{uuid}/attendees', [CalendarEventController::class, 'invite'])->name('events.invite');
        Route::delete('/events/{uuid}/attendees/{attendeeId}', [CalendarEventController::class, 'removeAttendee'])->name('events.attendees.remove');
        Route::post('/events/{uuid}/respond', [CalendarEventController::class, 'respond'])->name('events.respond');

        Route::patch('/calendars/{uuid}', [CalendarController::class, 'update'])->name('calendars.update');
        Route::delete('/calendars/{uuid}', [CalendarController::class, 'destroy'])->name('calendars.destroy');

        Route::post('/calendars/{uuid}/subscribe', [CalendarController::class, 'subscribe'])->name('calendars.subscribe');
        Route::delete('/calendars/{uuid}/subscribe', [CalendarController::class, 'unsubscribe'])->name('calendars.unsubscribe');
        Route::put('/calendars/{uuid}/subscription', [CalendarController::class, 'updateSubscription'])->name('calendars.subscription');

        /*
         * ICS. Import is two steps — preview the file, then commit the chosen
         * events — so nothing is written before it has been seen. Subscription
         * URLs are validated against private address ranges before the server
         * ever fetches them (SubscriptionUrl).
         */
        Route::post('/ics/preview', [CalendarIcsController::class, 'preview'])->name('ics.preview');
        Route::post('/ics/import', [CalendarIcsController::class, 'import'])->name('ics.import');
        Route::post('/ics/subscribe', [CalendarIcsController::class, 'subscribe'])->name('ics.subscribe');
        Route::post('/ics/{uuid}/refresh', [CalendarIcsController::class, 'refresh'])->name('ics.refresh');
        Route::put('/ics/{uuid}/enabled', [CalendarIcsController::class, 'setEnabled'])->name('ics.enabled');
        Route::get('/ics/events/{uuid}/export', [CalendarIcsController::class, 'exportEvent'])->name('ics.export-event');
        Route::get('/ics/{uuid}/export', [CalendarIcsController::class, 'export'])->name('ics.export');

        /*
         * Provider sync (Google, Microsoft). Connecting a provider calendar
         * creates a local mirror and queues a background sync; a failure is
         * recorded on that calendar's row, never surfaced as a page error.
         */
        Route::get('/sync/accounts', [CalendarSyncController::class, 'accounts'])->name('sync.accounts');
        Route::get('/sync/accounts/{accountId}/calendars', [CalendarSyncController::class, 'providerCalendars'])->name('sync.provider-calendars');
        Route::post('/sync/accounts/{accountId}/connect', [CalendarSyncController::class, 'connect'])->name('sync.connect');
        Route::post('/sync/accounts/{accountId}/connect-all', [CalendarSyncController::class, 'connectAll'])->name('sync.connect-all');
        Route::get('/sync/status', [CalendarSyncController::class, 'syncStatus'])->name('sync.status');
        Route::get('/sync/accounts/{accountId}/status', [CalendarSyncController::class, 'syncStatus'])->name('sync.account-status');
        Route::put('/sync/{uuid}', [CalendarSyncController::class, 'updateSync'])->name('sync.update');
        Route::post('/sync/{uuid}/run', [CalendarSyncController::class, 'sync'])->name('sync.run');
        Route::delete('/sync/{uuid}', [CalendarSyncController::class, 'disconnect'])->name('sync.disconnect');
        Route::get('/sync/{uuid}/conflicts', [CalendarSyncController::class, 'conflicts'])->name('sync.conflicts');
        Route::post('/events/{uuid}/resolve-conflict', [CalendarSyncController::class, 'resolveConflict'])->name('sync.resolve');

        Route::get('/calendars/{uuid}/history', [CalendarController::class, 'history'])->name('calendars.history');
        Route::get('/calendars/{uuid}/members', [CalendarController::class, 'members'])->name('calendars.members');
        Route::post('/calendars/{uuid}/members', [CalendarController::class, 'addMember'])->name('calendars.members.add');
        // Group grants are removed by group uuid; the numeric route is for a
        // single person, and is declared first so it wins for numeric ids.
        Route::delete('/calendars/{uuid}/members/{userId}', [CalendarController::class, 'removeMember'])
            ->whereNumber('userId')->name('calendars.members.remove');
        Route::delete('/calendars/{uuid}/group-members/{groupUuid}', [CalendarController::class, 'removeGroupMember'])
            ->name('calendars.group-members.remove');
    });

    /*
     * Groups: teams, departments, projects and committees. Staff-only, and
     * administrator-managed — a group manager curates membership but cannot
     * create or delete groups. What a group may *see* is never set here; that
     * is a grant made against a calendar.
     */
    Route::prefix('portal/groups')->name('groups.')->group(function () {
        Route::get('/', [GroupsController::class, 'index'])->name('index');
        Route::post('/', [GroupsController::class, 'store'])->name('store');
        // Literal path before /{uuid} so the wildcard can't swallow it.
        Route::get('/staff', [GroupsController::class, 'staff'])->name('staff');
        Route::patch('/{uuid}', [GroupsController::class, 'update'])->name('update');
        Route::delete('/{uuid}', [GroupsController::class, 'destroy'])->name('destroy');
        Route::get('/{uuid}/members', [GroupsController::class, 'members'])->name('members');
        Route::post('/{uuid}/members', [GroupsController::class, 'addMembers'])->name('members.add');
        Route::delete('/{uuid}/members/{userId}', [GroupsController::class, 'removeMember'])->name('members.remove');
    });

    /*
     * Portal Feed API (the /social/feed page).
     *
     * Channels are addressed by uuid and every route resolves through
     * FeedAccess, which 404s rather than 403s for a channel the caller cannot
     * see — a private channel's existence is itself information. The whole
     * prefix sits behind `feed.view`; what a person may do *inside* a channel
     * is their membership row's business, not the router's.
     */
    Route::prefix('portal/feed')->middleware('capability:feed.view')->name('feed.')->group(function () {
        /*
         * Channels. Literal paths come before the {uuid} wildcard so it can't
         * swallow them.
         */
        Route::get('/channels', [FeedChannelController::class, 'index'])->name('channels.index');
        Route::post('/channels', [FeedChannelController::class, 'store'])->name('channels.store');
        Route::get('/channels/{uuid}', [FeedChannelController::class, 'show'])->name('channels.show');
        Route::patch('/channels/{uuid}', [FeedChannelController::class, 'update'])->name('channels.update');
        Route::delete('/channels/{uuid}', [FeedChannelController::class, 'destroy'])->name('channels.destroy');

        // Profile picture and cover. `which` is validated in the controller.
        Route::post('/channels/{uuid}/image/{which}', [FeedChannelController::class, 'updateImage'])
            ->name('channels.image.store');
        Route::get('/channels/{uuid}/image/{which}', [FeedChannelController::class, 'image'])
            ->name('channels.image');

        Route::get('/channels/{uuid}/members', [FeedChannelController::class, 'members'])->name('channels.members');
        Route::post('/channels/{uuid}/members', [FeedChannelController::class, 'addMembersRequest'])
            ->name('channels.members.add');
        Route::patch('/channels/{uuid}/members/{userId}', [FeedChannelController::class, 'updateMember'])
            ->name('channels.members.update');
        Route::delete('/channels/{uuid}/members/{userId}', [FeedChannelController::class, 'removeMember'])
            ->name('channels.members.remove');

        Route::post('/channels/{uuid}/join', [FeedChannelController::class, 'join'])->name('channels.join');
        Route::post('/channels/{uuid}/leave', [FeedChannelController::class, 'leave'])->name('channels.leave');
        Route::post('/channels/{uuid}/read', [FeedChannelController::class, 'markRead'])->name('channels.read');
        Route::patch('/channels/{uuid}/membership', [FeedChannelController::class, 'updateMyMembership'])
            ->name('channels.membership');
        Route::post('/channels/{uuid}/archive', [FeedChannelController::class, 'archive'])->name('channels.archive');
        Route::post('/channels/{uuid}/restore', [FeedChannelController::class, 'restore'])->name('channels.restore');

        // Staged before the post that will own them; claimed on save.
        Route::post('/channels/{uuid}/attachments', [FeedAttachmentController::class, 'store'])
            ->name('attachments.store');

        /*
         * Posts. One collection serves the stream, drafts, scheduled posts,
         * bookmarks, mentions and pinned — they differ by the `view` parameter,
         * not by endpoint, because they are the same rows read differently.
         */
        Route::get('/posts', [FeedPostController::class, 'index'])->name('posts.index');
        Route::post('/posts', [FeedPostController::class, 'store'])->name('posts.store');
        Route::get('/posts/{uuid}', [FeedPostController::class, 'show'])->name('posts.show');
        Route::patch('/posts/{uuid}', [FeedPostController::class, 'update'])->name('posts.update');
        Route::delete('/posts/{uuid}', [FeedPostController::class, 'destroy'])->name('posts.destroy');
        // Runs on a timer while someone types, so it never logs or stamps.
        Route::put('/posts/{uuid}/autosave', [FeedPostController::class, 'autosave'])->name('posts.autosave');
        Route::post('/posts/{uuid}/publish', [FeedPostController::class, 'publish'])->name('posts.publish');
        Route::post('/posts/{uuid}/duplicate', [FeedPostController::class, 'duplicate'])->name('posts.duplicate');

        Route::post('/posts/{uuid}/pin', [FeedPostController::class, 'togglePin'])->name('posts.pin');
        Route::post('/posts/{uuid}/lock', [FeedPostController::class, 'toggleLock'])->name('posts.lock');
        Route::post('/posts/{uuid}/bookmark', [FeedPostController::class, 'toggleBookmark'])->name('posts.bookmark');
        Route::post('/posts/{uuid}/share', [FeedPostController::class, 'share'])->name('posts.share');
        Route::post('/posts/{uuid}/acknowledge', [FeedPostController::class, 'acknowledge'])
            ->name('posts.acknowledge');
        Route::get('/posts/{uuid}/acknowledgements', [FeedPostController::class, 'acknowledgements'])
            ->name('posts.acknowledgements');

        // Toggling: reacting again with the same emoji removes it.
        Route::post('/posts/{uuid}/reactions', [FeedReactionController::class, 'post'])->name('posts.react');
        Route::get('/posts/{uuid}/reactions', [FeedReactionController::class, 'people'])->name('posts.reactions');

        Route::post('/posts/{uuid}/poll/vote', [FeedPollController::class, 'vote'])->name('polls.vote');
        Route::post('/posts/{uuid}/poll/close', [FeedPollController::class, 'close'])->name('polls.close');
        Route::get('/posts/{uuid}/poll/voters', [FeedPollController::class, 'voters'])->name('polls.voters');

        Route::get('/posts/{uuid}/comments', [FeedCommentController::class, 'index'])->name('comments.index');
        Route::post('/posts/{uuid}/comments', [FeedCommentController::class, 'store'])->name('comments.store');
        Route::patch('/comments/{uuid}', [FeedCommentController::class, 'update'])->name('comments.update');
        Route::delete('/comments/{uuid}', [FeedCommentController::class, 'destroy'])->name('comments.destroy');
        Route::post('/comments/{uuid}/reactions', [FeedReactionController::class, 'comment'])
            ->name('comments.react');

        // Attachment bytes. Both re-check channel access on every request.
        Route::delete('/attachments/{uuid}', [FeedAttachmentController::class, 'destroy'])
            ->name('attachments.destroy');
        Route::get('/attachments/{uuid}', [FeedAttachmentController::class, 'show'])->name('attachments.show');
        Route::get('/attachments/{uuid}/thumb', [FeedAttachmentController::class, 'thumb'])
            ->name('attachments.thumb');

        // Search, the composer's @/# autocomplete, and analytics.
        Route::get('/search', FeedSearchController::class)->name('search');
        Route::get('/mentionable', [FeedSearchController::class, 'mentionable'])->name('mentionable');
        Route::get('/hashtags', [FeedSearchController::class, 'hashtagSuggestions'])->name('hashtags');
        Route::get('/analytics', FeedAnalyticsController::class)->name('analytics');
    });

    /*
     * Portal messaging API (the /social/messages page). Conversations are
     * addressed by uuid and every route resolves through the caller's
     * participation, so a non-member gets a 404 rather than a 403.
     */
    Route::prefix('portal/messaging')->name('messaging.')->group(function () {
        Route::get('/conversations', [MessagingController::class, 'index'])->name('conversations.index');
        Route::post('/conversations', [MessagingController::class, 'store'])->name('conversations.store');

        // Literal paths before the {uuid} wildcard so it can't swallow them.
        Route::get('/contacts', [MessagingController::class, 'contacts'])->name('contacts');

        /*
         * Group administration. Membership is still checked first, so a
         * non-member gets a 404 before permissions are considered.
         */
        Route::post('/groups', [MessagingGroupController::class, 'store'])->name('groups.store');
        Route::patch('/groups/{uuid}', [MessagingGroupController::class, 'update'])->name('groups.update');
        Route::post('/groups/{uuid}/photo', [MessagingGroupController::class, 'updatePhoto'])->name('groups.photo');
        Route::post('/groups/{uuid}/members', [MessagingGroupController::class, 'addMembers'])->name('groups.members.add');
        Route::patch('/groups/{uuid}/members/{userId}', [MessagingGroupController::class, 'updateMember'])->name('groups.members.update');
        Route::delete('/groups/{uuid}/members/{userId}', [MessagingGroupController::class, 'removeMember'])->name('groups.members.remove');
        Route::post('/heartbeat', [MessagingController::class, 'heartbeat'])->name('heartbeat');
        Route::get('/link-preview', [MessagingController::class, 'linkPreview'])->name('link-preview');
        // Grouped search across people, conversations, messages, files, links.
        Route::get('/search', [MessagingController::class, 'search'])->name('search');
        // Every piece of media the user can see, pooled across all their
        // conversations — the inbox column's Media view, as opposed to the
        // per-thread shelf on conversations/{uuid}/gallery.
        Route::get('/media', [MessagingController::class, 'media'])->name('media');
        // Recent call history across all the user's conversations — the Calls tab.
        Route::get('/calls', [MessagingController::class, 'calls'])->name('calls');
        // Badges on the Messages nav bar, and the act of clearing one.
        Route::get('/tab-counts', [MessagingController::class, 'tabCounts'])->name('tab-counts');
        Route::post('/tab-counts/seen', [MessagingController::class, 'markTabSeen'])->name('tab-counts.seen');
        // Bulk receipt acknowledgement — one call covers every conversation.
        Route::post('/delivered', [MessagingController::class, 'markAllDelivered'])->name('delivered');
        Route::get('/settings', [MessagingController::class, 'settings'])->name('settings');
        Route::put('/settings', [MessagingController::class, 'updateSettings'])->name('settings.update');

        Route::get('/conversations/{uuid}/messages', [MessagingController::class, 'messages'])->name('conversations.messages');
        Route::post('/conversations/{uuid}/messages', [MessagingController::class, 'send'])->name('conversations.send');
        Route::post('/conversations/{uuid}/read', [MessagingController::class, 'markRead'])->name('conversations.read');
        Route::post('/conversations/{uuid}/unread', [MessagingController::class, 'markUnread'])->name('conversations.unread');
        Route::post('/conversations/{uuid}/delivered', [MessagingController::class, 'markDelivered'])->name('conversations.delivered');
        Route::post('/conversations/{uuid}/typing', [MessagingController::class, 'typing'])->name('conversations.typing');

        // Conversation-level actions behind the chat menu. Clearing and
        // leaving are one-sided: neither touches the other participant's copy.
        Route::post('/conversations/{uuid}/clear', [MessagingController::class, 'clearChat'])->name('conversations.clear');
        Route::post('/conversations/{uuid}/block', [MessagingController::class, 'block'])->name('conversations.block');
        Route::post('/conversations/{uuid}/unblock', [MessagingController::class, 'unblock'])->name('conversations.unblock');
        Route::get('/conversations/{uuid}/export', [MessagingController::class, 'export'])->name('conversations.export');
        Route::delete('/conversations/{uuid}', [MessagingController::class, 'destroyConversation'])->name('conversations.destroy');
        Route::put('/conversations/{uuid}/draft', [MessagingController::class, 'saveDraft'])->name('conversations.draft');
        Route::patch('/conversations/{uuid}', [MessagingController::class, 'updateConversation'])->name('conversations.update');
        Route::get('/conversations/{uuid}/photo', [MessagingAttachmentController::class, 'conversationPhoto'])->name('conversations.photo');
        // The messaging profile panel and its shared-content shelves.
        Route::get('/conversations/{uuid}/info', [MessagingController::class, 'info'])->name('conversations.info');
        Route::get('/conversations/{uuid}/gallery', [MessagingController::class, 'gallery'])->name('conversations.gallery');

        Route::patch('/messages/{uuid}', [MessagingController::class, 'updateMessage'])->name('messages.update');
        Route::delete('/messages/{uuid}', [MessagingController::class, 'destroyMessage'])->name('messages.destroy');
        // Toggling: reacting again with the same emoji removes it.
        Route::post('/messages/{uuid}/reactions', [MessagingController::class, 'react'])->name('messages.react');
        Route::post('/messages/{uuid}/star', [MessagingController::class, 'toggleStar'])->name('messages.star');
        Route::post('/messages/{uuid}/forward', [MessagingController::class, 'forwardMessage'])->name('messages.forward');
        Route::post('/conversations/{uuid}/call', [MessagingController::class, 'callSignal'])->name('conversations.call');

        // Files are staged by upload first, then claimed by a message on send,
        // so the composer can preview and remove them before anything is sent.
        Route::post('/conversations/{uuid}/attachments', [MessagingController::class, 'uploadAttachment'])->name('conversations.attachments.store');
        Route::delete('/attachments/{uuid}', [MessagingController::class, 'destroyStagedAttachment'])->name('attachments.destroy');

        Route::get('/attachments/{uuid}', [MessagingAttachmentController::class, 'show'])->name('attachments.show');
        Route::get('/attachments/{uuid}/thumb', [MessagingAttachmentController::class, 'thumb'])->name('attachments.thumb');

        /*
         * Client-call recording capture. `start` decides — server-side, never
         * in the browser — whether this call records at all; chunks stream in
         * while the call runs; finish assembles them into the Vault.
         */
        Route::post('/conversations/{uuid}/recordings', [CallRecordingController::class, 'start'])->name('recordings.start');
        Route::post('/recordings/{uuid}/chunks', [CallRecordingController::class, 'chunk'])->name('recordings.chunk');
        Route::post('/recordings/{uuid}/finish', [CallRecordingController::class, 'finish'])->name('recordings.finish');
    });

    /*
     * The Client Call Recordings area (/call-recordings). Staff tooling:
     * gated by callRecordings.view and 404 to everyone else, the same
     * absent-not-forbidden rule the CBI module set.
     */
    Route::prefix('portal/call-recordings')->name('call-recordings.')->group(function () {
        Route::get('/', [CallRecordingController::class, 'index'])->name('index');
        Route::get('/{uuid}/media', [CallRecordingController::class, 'media'])->name('media');
    });

    /*
     * CBI (Citizenship by Investment) — in development, deliberately dark.
     * No sidebar entry, no SPA page, no Role capability: the only way in is
     * knowing the URL. Every endpoint 404s (never 403s) unless FEATURE_CBI
     * is on AND the caller is an administrator, so to everyone else the
     * module does not exist. Promotion to a real page later means adding
     * the slug to SPA_PAGES + a capability — the API stays as it is.
     */
    Route::prefix('portal/cbi')->name('cbi.')->group(function () {
        Route::get('/summary', [CbiController::class, 'summary'])->name('summary');
        Route::get('/applications', [CbiController::class, 'applications'])->name('applications');
        Route::get('/sync', [CbiController::class, 'syncStatus'])->name('sync.status');
        Route::post('/sync', [CbiController::class, 'triggerSync'])->name('sync.trigger');
        Route::get('/attachments/{attachment}', [CbiController::class, 'downloadAttachment'])
            ->whereNumber('attachment')->name('attachments.download');
        Route::get('/applications/{uuid}', [CbiController::class, 'application'])->name('applications.show');
        Route::post('/applications/{uuid}/comments', [CbiController::class, 'storeComment'])->name('applications.comments');
    });

    /*
     * Client deep links.
     *
     * clients.js has parsed these paths for a long time — detail, edit,
     * companies — but nothing served them, so the URL was only ever correct
     * until you reloaded, and a link to a client opened the directory. They
     * cannot go in PORTAL_PAGES because whereIn compiles that list into the
     * route pattern, and a uid is not a value anybody can list.
     *
     * Declared before the catch-all: `{page}` would otherwise swallow
     * "clients" and 404 on the segment after it.
     */
    Route::get('/citizenship-applications/{rest}', [LegacyPageController::class, 'clients'])
        ->where('rest', '[A-Za-z0-9][A-Za-z0-9\-_/]*')
        ->name('citizenship-applications.deep');

    Route::get('/clients/{rest}', [LegacyPageController::class, 'clients'])
        ->where('rest', '[A-Za-z0-9][A-Za-z0-9\-_/]*')
        ->name('clients.deep');

    Route::get('/{page}', LegacyPageController::class)
        ->whereIn('page', LegacyPageController::PORTAL_PAGES);
});

/*
 * Post-verification onboarding (available before admin approval).
 * Fortify owns /auth/login, /auth/register, /auth/forgot-password,
 * /auth/two-factor-challenge, /auth/user/* and the email verification routes.
 */
Route::middleware('guest')->group(function () {
    Route::get('/auth/login-code', [EmailTwoFactorController::class, 'show'])->name('login-code.show');
    Route::post('/auth/login-code', [EmailTwoFactorController::class, 'store'])
        ->middleware('throttle:two-factor')
        ->name('login-code.store');
    Route::post('/auth/login-code/resend', [EmailTwoFactorController::class, 'resend'])
        ->name('login-code.resend');
    Route::post('/auth/login-code/from-app', [EmailTwoFactorController::class, 'fromApp'])
        ->name('login-code.from-app');
});
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/auth/profile-setup', [ProfileSetupController::class, 'show'])->name('profile-setup');
    Route::post('/auth/profile-setup', [ProfileSetupController::class, 'store'])->name('profile-setup.store');

    Route::get('/auth/pending', fn (Request $request) => view('auth.pending', [
        'user' => $request->user(),
    ]))->name('pending');

    // The waiting screens poll this and release themselves the moment an
    // administrator acts — nobody should have to know to refresh.
    Route::get('/auth/pending-status', fn (Request $request) => response()->json([
        'approved' => (bool) $request->user()?->isApproved(),
        'hasRole' => $request->user() && $request->user()->account_type !== Role::EMPLOYEE,
    ]))->name('pending.status');

    // The holding screen for approved accounts still typed 'Employee' — the
    // portal's roles are the brief's five (Administrator, the two officer
    // types, and the external Service Provider / Private Client accounts),
    // and an account with none of them waits here until an administrator
    // assigns one. Deliberately inside the same pre-approval group so the
    // account.approved gate that sends people here cannot loop.
    //
    // Once a real role is assigned, this URL must release them: a browser
    // refresh lands back on the same path, and without the check below the
    // holding screen would keep rendering forever even though the gate that
    // sent them here would now let them through.
    Route::get('/auth/role-pending', function (Request $request) {
        $user = $request->user();

        if ($user && ! $user->isApproved()) {
            return redirect('/auth/pending');
        }

        if (! $user || $user->account_type !== Role::EMPLOYEE) {
            return redirect('/');
        }

        return view('auth.role-pending', ['user' => $user]);
    })->name('role-pending');
});

/*
 * The security checklist: shown once, after an administrator approves the
 * account. Sits outside the 'onboarded' gate so it can't redirect to itself.
 */
/*
 * Guided client onboarding. Sits outside both 'profile.complete' and
 * 'onboarded' — it is the screen those two redirect *to* for a client, and
 * gating it on either would loop. It collects everything profile-setup asks
 * for, which is why a client never sees that screen.
 */
Route::middleware(['auth', 'verified', 'account.approved'])->group(function () {
    Route::get('/onboarding', [ClientOnboardingController::class, 'index'])->name('onboarding.index');
    Route::get('/onboarding/{step}', [ClientOnboardingController::class, 'show'])
        ->where('step', '[a-z-]+')->name('onboarding.show');
    Route::post('/onboarding/{step}', [ClientOnboardingController::class, 'store'])
        ->where('step', '[a-z-]+')->name('onboarding.store');
    Route::post('/onboarding/{step}/back', [ClientOnboardingController::class, 'back'])
        ->where('step', '[a-z-]+')->name('onboarding.back');
    Route::post('/onboarding-complete', [ClientOnboardingController::class, 'complete'])->name('onboarding.complete');
});

Route::middleware(['auth', 'verified', 'account.approved'])->group(function () {
    Route::get('/auth/setup/{step}', [AccountSetupController::class, 'show'])
        ->where('step', '[a-z-]+')->name('account-setup.show');
    Route::post('/auth/setup/{step}', [AccountSetupController::class, 'store'])
        ->where('step', '[a-z-]+')->name('account-setup.store');
    Route::post('/auth/setup/{step}/skip', [AccountSetupController::class, 'skip'])
        ->where('step', '[a-z-]+')->name('account-setup.skip');
    Route::get('/auth/setup/two-factor/qr', [AccountSetupController::class, 'twoFactorQr'])
        ->name('account-setup.two-factor.qr');
    Route::get('/auth/setup/two-factor/recovery-codes', [AccountSetupController::class, 'twoFactorRecoveryCodes'])
        ->name('account-setup.two-factor.recovery');
});

Route::middleware(['auth', 'verified', 'profile.complete', 'account.approved'])->group(function () {
    Route::get('/auth/getting-started', [GettingStartedController::class, 'show'])->name('getting-started');
    Route::post('/auth/getting-started', [GettingStartedController::class, 'finish'])->name('getting-started.finish');
});

/*
 * Public static pages. Registered as literal URIs - a second '/{page}'
 * route would silently replace the portal one in the route collection.
 */
foreach (LegacyPageController::PUBLIC_PAGES as $publicPage) {
    Route::get('/'.$publicPage, fn () => app(LegacyPageController::class)(request(), $publicPage));
}

/*
 * Social sign-in (Google now; Microsoft next). Redirect/callback serve both
 * guests (sign up / sign in) and signed-in users (connect from Security).
 */
Route::get('/auth/social/{provider}/redirect', [SocialAuthController::class, 'redirect'])
    ->name('social.redirect');

/*
 * Mailbox / calendar / OneDrive connect for someone already signed in.
 *
 * The desktop shell treats `/auth/social/.../redirect` from any `/auth/*`
 * page as a fresh sign-in and opens `/auth/desktop/start` instead of
 * Microsoft or Google. Getting-started lives under `/auth/`, so those
 * Connect buttons have to leave that pattern.
 */
Route::get('/connect/{provider}', [SocialAuthController::class, 'redirect'])
    ->middleware('auth')
    ->where('provider', 'google|microsoft')
    ->name('social.connect');

Route::get('/auth/social/{provider}/callback', [SocialAuthController::class, 'callback'])
    ->name('social.callback');

Route::post('/auth/social/{provider}/disconnect', [SocialAuthController::class, 'disconnect'])
    ->middleware(['auth', 'verified'])
    ->name('social.disconnect');

/*
 * Desktop app sign-in handoff. The macOS shell cannot host Google's OAuth
 * itself (embedded webviews are refused), so it opens the system browser here
 * and redeems the result over the tmaportal:// scheme. See DesktopAuthController.
 */
Route::get('/auth/desktop/start', [DesktopAuthController::class, 'start'])
    ->middleware('throttle:20,1')
    ->name('desktop.start');

Route::get('/auth/desktop/finish', [DesktopAuthController::class, 'finish'])
    ->middleware('auth')
    ->name('desktop.finish');

Route::get('/auth/desktop/claim', [DesktopAuthController::class, 'claim'])
    ->middleware('throttle:20,1')
    ->name('desktop.claim');

// Human-facing download links, resolved from the same manifests. Registered
// before the feed below, which would otherwise swallow /desktop/releases.
Route::get('/desktop/releases', [DesktopReleasesController::class, 'index'])
    ->name('desktop.releases');

Route::get('/desktop/download/{platform}', [DesktopReleasesController::class, 'download'])
    ->where('platform', 'mac|windows')
    ->name('desktop.download');

// Identity of this deploy's static assets. The desktop app ships a copy and
// serves it locally only when this matches exactly — see the controller.
Route::get('/desktop/assets', [DesktopAssetsController::class, 'show'])
    ->name('desktop.assets');

// The same identity, without the two thousand hashes. The app polls this to
// notice a deploy that happened while it was open, and only fetches the full
// manifest above when the answer has changed.
Route::get('/desktop/build', [DesktopAssetsController::class, 'build'])
    ->name('desktop.build');

// Update feed the installed macOS app polls. Public by design: it serves only
// the signed builds we publish, and the app has no session when it checks.
Route::get('/desktop/{file}', DesktopUpdateController::class)
    ->where('file', '[A-Za-z0-9 ._-]+')
    ->name('desktop.update');

/*
 * Post-login "Stay signed in?" — asked after Google, Microsoft, or email
 * sign-in (and after 2FA when that applies). Must be authenticated to choose.
 */
Route::middleware('auth')->group(function () {
    Route::get('/auth/stay-signed-in', [StaySignedInController::class, 'show'])
        ->name('stay-signed-in.show');
    Route::post('/auth/stay-signed-in', [StaySignedInController::class, 'store'])
        ->name('stay-signed-in.store');
});

/*
 * Public signing links (no login, no portal). The token is the only
 * credential: it identifies one recipient of one request, and the controller
 * re-checks their turn on every action. Rate-limited because these are the
 * only unauthenticated write endpoints in the app — a valid token is 64 chars
 * of CSPRNG output, so the limit is about abuse of a known link, not guessing.
 */
Route::middleware('throttle:signing')->group(function () {
    Route::get('/sign/{token}', [PublicSigningController::class, 'show'])->name('sign.show');
    Route::get('/sign/{token}/document', [PublicSigningController::class, 'document'])->name('sign.document');
    Route::post('/sign/{token}/progress', [PublicSigningController::class, 'progress'])->name('sign.progress');
    Route::post('/sign/{token}/submit', [PublicSigningController::class, 'submit'])->name('sign.submit');
    Route::post('/sign/{token}/decline', [PublicSigningController::class, 'decline'])->name('sign.decline');
    Route::post('/sign/{token}/approve', [PublicSigningController::class, 'approve'])->name('sign.approve');
    Route::post('/sign/{token}/request-changes', [PublicSigningController::class, 'requestChanges'])->name('sign.request-changes');
});

/*
 * Public share links (no login). Keyed off the random token only — never a
 * storage path or database id.
 */
Route::get('/s/{token}', [PublicShareController::class, 'show'])->name('share.show');
Route::post('/s/{token}/unlock', [PublicShareController::class, 'unlock'])->name('share.unlock');
Route::get('/s/{token}/preview', [PublicShareController::class, 'preview'])->name('share.preview');
Route::get('/s/{token}/download', [PublicShareController::class, 'download'])->name('share.download');
Route::get('/s/{token}/file/{fileUuid}', [PublicShareController::class, 'file'])->name('share.file');

/*
 * Secure upload links (no login) — the receiving half of Request Files.
 *
 * The only route in the portal where somebody without an account writes bytes,
 * so it is throttled and the token is the only key: the destination, the size
 * and type rules, and the owner of whatever arrives all come from the stored
 * request, never from the form. See PublicUploadController.
 */
Route::middleware('throttle:uploads')->group(function () {
    Route::get('/r/{token}', [PublicUploadController::class, 'show'])
        ->where('token', '[A-Za-z0-9]+')->name('upload.show');
    Route::post('/r/{token}/unlock', [PublicUploadController::class, 'unlock'])
        ->where('token', '[A-Za-z0-9]+')->name('upload.unlock');
    Route::post('/r/{token}/upload', [PublicUploadController::class, 'upload'])
        ->where('token', '[A-Za-z0-9]+')->name('upload.store');
});

/*
 * Invitations: the public accept flow from an emailed link. No login (that's
 * the point) — the token in the link is the only key, and the controller
 * re-checks it on every action. Throttled like the other public token routes,
 * since these are unauthenticated and can create an account.
 */
Route::middleware('throttle:invitations')->group(function () {
    Route::get('/invite/{token}', [InvitationAcceptController::class, 'show'])
        ->where('token', '[A-Za-z0-9]+')->name('invite.show');
    Route::post('/invite/{token}', [InvitationAcceptController::class, 'register'])
        ->where('token', '[A-Za-z0-9]+')->name('invite.register');
    Route::post('/invite/{token}/accept', [InvitationAcceptController::class, 'accept'])
        ->where('token', '[A-Za-z0-9]+')->name('invite.accept');
    Route::post('/invite/{token}/decline', [InvitationAcceptController::class, 'decline'])
        ->where('token', '[A-Za-z0-9]+')->name('invite.decline');
    Route::post('/invite/{token}/signin', [InvitationAcceptController::class, 'signin'])
        ->where('token', '[A-Za-z0-9]+')->name('invite.signin');
});

/*
 * The address the first generation of client invitations was sent to. Kept so
 * any link already in somebody's inbox still lands somewhere useful.
 */
Route::get('/client-invite/{token}', fn (string $token) => redirect('/invite/'.$token))
    ->where('token', '[A-Za-z0-9]+')->name('client-invite.show');

/*
 * Email postcard gallery. A staff-only documentation site that renders every
 * transactional email from sample data for review and approval, before any of
 * them are wired to real events. Available on the live portal (unlike the
 * local-only /design previews below) so it can actually be signed off on.
 */
Route::get('/design/mail', [MailPreviewController::class, 'index'])
    ->middleware(['auth', 'verified', 'account.approved'])
    ->name('design.mail.index');

/*
 * CBI development preview. Like /design/mail it exists in production so the
 * module can be QA'd on live data before launch, but it is invisible: the
 * controller 404s unless FEATURE_CBI is on and the caller is an admin.
 */
Route::get('/dev/cbi', [CbiController::class, 'page'])
    ->middleware(['auth', 'verified', 'account.approved'])
    ->name('dev.cbi');

/*
 * Friendly aliases from the design-phase URLs.
 */
Route::redirect('/auth/sign-in', '/auth/login');
Route::redirect('/auth/sign-up', '/auth/register');
Route::redirect('/sign-in', '/auth/login');
Route::redirect('/sign-up', '/auth/register');
Route::redirect('/forgot-password', '/auth/forgot-password');
Route::redirect('/setup-new-password', '/auth/forgot-password');
Route::redirect('/two-step-verification', '/auth/two-factor-challenge');

/*
 * Design previews - local development only. The auth/security prototypes
 * live in design/previews/ (outside the web root) and are never served
 * in production or included in the GitHub Pages build.
 */
if (app()->environment('local')) {
    // Read-only database browser (local dev, admin-only, secrets redacted).
    Route::get('/design/db', DevDatabaseController::class)
        ->middleware(['auth', 'verified', 'account.approved'])
        ->name('dev.database');

    Route::view('/demo/avatars', 'demo.avatars');

    Route::get('/design/auth/{page?}', function (?string $page = null) {
        $path = base_path('design/previews/auth/'.($page !== null ? $page.'/' : '').'index.html');

        abort_unless(is_file($path), 404);

        return response()->file($path);
    })->where('page', '[a-z0-9\-]+');

    Route::get('/design/security-settings', function () {
        $path = base_path('design/previews/security-settings/index.html');

        abort_unless(is_file($path), 404);

        return response()->file($path);
    });
}
