<?php

use App\Http\Controllers\ActivityController;
use App\Http\Controllers\AdminSecurityController;
use App\Http\Controllers\AdminUsersController;
use App\Http\Controllers\AvatarController;
use App\Http\Controllers\CalendarController;
use App\Http\Controllers\CalendarEventController;
use App\Http\Controllers\CalendarIcsController;
use App\Http\Controllers\CalendarSyncController;
use App\Http\Controllers\ClientAssignmentController;
use App\Http\Controllers\ClientsController;
use App\Http\Controllers\ConnectorsController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DashboardMetricsController;
use App\Http\Controllers\DevDatabaseController;
use App\Http\Controllers\FileLibraryController;
use App\Http\Controllers\Files\BrowserController;
use App\Http\Controllers\Files\BulkController;
use App\Http\Controllers\Files\FavoriteController;
use App\Http\Controllers\Files\FileController;
use App\Http\Controllers\Files\FolderController;
use App\Http\Controllers\Files\PublicShareController;
use App\Http\Controllers\Files\RecycleBinController;
use App\Http\Controllers\Files\ShareController;
use App\Http\Controllers\Files\ShortcutController;
use App\Http\Controllers\Files\ThumbnailController;
use App\Http\Controllers\Files\UploadController;
use App\Http\Controllers\GettingStartedController;
use App\Http\Controllers\GroupsController;
use App\Http\Controllers\LegacyPageController;
use App\Http\Controllers\MailController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\MessagingAttachmentController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\MessagingController;
use App\Http\Controllers\MessagingGroupController;
use App\Http\Controllers\PreferencesController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProfileSetupController;
use App\Http\Controllers\SecuritySettingsController;
use App\Http\Controllers\Signatures\PublicSigningController;
use App\Http\Controllers\Signatures\SignatureFieldController;
use App\Http\Controllers\Signatures\SignatureRequestController;
use App\Http\Controllers\SocialAuthController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Portal - requires login, verified email, and administrator approval.
 */
Route::middleware(['auth', 'verified', 'profile.complete', 'account.approved', 'onboarded', 'mfa.enforced'])->group(function () {
    Route::get('/', DashboardController::class);

    // KPI cards on the portal home. Staff-facing: see DashboardMetricsController.
    Route::get('/portal/dashboard/metrics', DashboardMetricsController::class)
        ->name('dashboard.metrics');

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

    Route::get('/profile', [ProfileController::class, 'show'])->name('profile');
    Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');

    // One settings home: the Account settings rail. The old Settings menu
    // is gone; its sections live in that rail.
    Route::redirect('/settings', '/account-settings');

    Route::get('/me', [MeController::class, 'show'])->name('me');
    Route::get('/me/profile', [MeController::class, 'profile'])->name('me.profile');
    Route::post('/me/avatar', [MeController::class, 'updateAvatar'])->name('me.avatar');
    Route::get('/me/preferences', [PreferencesController::class, 'show'])->name('me.preferences');
    Route::put('/me/preferences', [PreferencesController::class, 'update'])->name('me.preferences.update');
    Route::get('/media/avatars/{name}', [AvatarController::class, 'show'])->name('avatar.show');

    // Notifications: the bell popup, the right-sidebar section, and the badge.
    Route::prefix('portal/notifications')->name('notifications.')->group(function () {
        Route::get('/', [NotificationController::class, 'index'])->name('index');
        Route::get('/count', [NotificationController::class, 'count'])->name('count');
        Route::get('/preferences', [NotificationController::class, 'preferences'])->name('preferences');
        Route::put('/preferences', [NotificationController::class, 'updatePreferences'])->name('preferences.update');
        Route::post('/read-all', [NotificationController::class, 'readAll'])->name('read-all');
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

    Route::get('/admin/connectors', [ConnectorsController::class, 'index'])->name('admin.connectors');
    Route::put('/admin/connectors', [ConnectorsController::class, 'update'])->name('admin.connectors.update');

    Route::get('/admin/security-policies', [AdminSecurityController::class, 'show'])
        ->name('admin.security-policies');

    Route::put('/admin/security-policies/{section}', [AdminSecurityController::class, 'update'])
        ->name('admin.security-policies.update');

    Route::view('/demo/avatars', 'demo.avatars');

    /*
     * File & folder manager API. Everything is authorized server-side in the
     * controllers (FileAccess) — the client's hidden buttons are never trusted.
     * Files/folders are addressed by public uuid; storage paths are never exposed.
     */
    Route::prefix('portal/files')->name('files.')->group(function () {
        Route::get('/', [BrowserController::class, 'index'])->name('browse');

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
        Route::post('/files/{uuid}/move', [FileController::class, 'move'])->name('move');
        Route::post('/files/{uuid}/copy', [FileController::class, 'copy'])->name('copy');
        Route::delete('/files/{uuid}', [FileController::class, 'destroy'])->name('destroy');
        Route::post('/files/{uuid}/restore', [FileController::class, 'restore'])->name('restore');
        Route::delete('/files/{uuid}/force', [FileController::class, 'forceDelete'])->name('force');
        Route::get('/files/{uuid}/download', [FileController::class, 'download'])->name('download');
        Route::get('/files/{uuid}/preview', [FileController::class, 'preview'])->name('preview');
        Route::get('/files/{uuid}/thumb', [ThumbnailController::class, 'show'])->name('thumb');

        Route::post('/uploads', [UploadController::class, 'init'])->name('uploads.init');
        Route::post('/uploads/{uuid}/chunk', [UploadController::class, 'chunk'])->name('uploads.chunk');
        Route::get('/uploads/{uuid}/status', [UploadController::class, 'status'])->name('uploads.status');
        Route::post('/uploads/{uuid}/complete', [UploadController::class, 'complete'])->name('uploads.complete');
        Route::delete('/uploads/{uuid}', [UploadController::class, 'abort'])->name('uploads.abort');

        Route::get('/shortcuts', [ShortcutController::class, 'index'])->name('shortcuts.index');
        Route::post('/shortcuts', [ShortcutController::class, 'store'])->name('shortcuts.store');
        Route::put('/shortcuts/reorder', [ShortcutController::class, 'reorder'])->name('shortcuts.reorder');
        Route::delete('/shortcuts/{uuid}', [ShortcutController::class, 'destroy'])->name('shortcuts.destroy');

        Route::post('/favorites/toggle', [FavoriteController::class, 'toggle'])->name('favorites.toggle');
        Route::post('/recycle-bin/empty', [RecycleBinController::class, 'empty'])->name('recycle.empty');
        Route::post('/bulk', [BulkController::class, 'handle'])->name('bulk');

        Route::get('/shares', [ShareController::class, 'index'])->name('shares.index');
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
        Route::get('/{uid}/assignments', [ClientAssignmentController::class, 'index'])->name('assignments.index');
        Route::post('/{uid}/assignments', [ClientAssignmentController::class, 'store'])->name('assignments.store');
        Route::delete('/{uid}/assignments/{userId}', [ClientAssignmentController::class, 'destroy'])->name('assignments.destroy');
        Route::get('/{uid}', [ClientsController::class, 'show'])->name('show');
        Route::patch('/{uid}', [ClientsController::class, 'update'])->name('update');
        Route::delete('/{uid}', [ClientsController::class, 'destroy'])->name('destroy');
        Route::post('/{uid}/duplicate', [ClientsController::class, 'duplicate'])->name('duplicate');
    });

    /*
     * Mailbox API. Backed by the user's connected Google or Microsoft account
     * (see App\Support\Mail). Messages are addressed by uuid; every write hits
     * the provider first and is mirrored locally only once it succeeds.
     */
    Route::prefix('portal/mail')->name('mail.')->group(function () {
        Route::get('/', [MailController::class, 'index'])->name('index');
        Route::post('/sync', [MailController::class, 'sync'])->name('sync');
        Route::get('/sync-status', [MailController::class, 'syncStatus'])->name('sync-status');
        Route::get('/sender-photo/{hash}', [MailController::class, 'senderPhoto'])
            ->where('hash', '[a-f0-9]{64}')->name('sender-photo');

        Route::get('/settings', [MailController::class, 'settings'])->name('settings');
        Route::put('/settings', [MailController::class, 'updateSettings'])->name('settings.update');

        // Literal paths before /{uuid} so the wildcard doesn't swallow them.
        Route::get('/drafts', [MailController::class, 'drafts'])->name('drafts');
        Route::post('/drafts', [MailController::class, 'saveDraft'])->name('drafts.save');
        Route::delete('/drafts/{uuid}', [MailController::class, 'deleteDraft'])->name('drafts.delete');

        Route::post('/send', [MailController::class, 'send'])->name('send');
        Route::post('/bulk', [MailController::class, 'bulk'])->name('bulk');
        Route::get('/attachments/{uuid}', [MailController::class, 'attachment'])->name('attachment');

        Route::get('/messages', [MailController::class, 'messages'])->name('messages');
        // Every message in the conversation the given message belongs to.
        Route::get('/messages/{uuid}/thread', [MailController::class, 'thread'])->name('messages.thread');
        Route::get('/messages/{uuid}', [MailController::class, 'show'])->name('messages.show');
        Route::patch('/messages/{uuid}', [MailController::class, 'update'])->name('messages.update');
        Route::post('/messages/{uuid}/move', [MailController::class, 'move'])->name('messages.move');
        Route::post('/messages/{uuid}/labels', [MailController::class, 'setLabel'])->name('messages.labels');
        Route::delete('/messages/{uuid}', [MailController::class, 'destroy'])->name('messages.destroy');
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
        // What colleagues are working on — the Updates tab, and where the
        // signed-in user sets their own.
        Route::get('/updates', [MessagingController::class, 'updates'])->name('updates');
        Route::put('/updates', [MessagingController::class, 'setUpdate'])->name('updates.set');
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

        // Files are staged by upload first, then claimed by a message on send,
        // so the composer can preview and remove them before anything is sent.
        Route::post('/conversations/{uuid}/attachments', [MessagingController::class, 'uploadAttachment'])->name('conversations.attachments.store');
        Route::delete('/attachments/{uuid}', [MessagingController::class, 'destroyStagedAttachment'])->name('attachments.destroy');

        Route::get('/attachments/{uuid}', [MessagingAttachmentController::class, 'show'])->name('attachments.show');
        Route::get('/attachments/{uuid}/thumb', [MessagingAttachmentController::class, 'thumb'])->name('attachments.thumb');
    });

    Route::get('/{page}', LegacyPageController::class)
        ->whereIn('page', LegacyPageController::PORTAL_PAGES);
});

/*
 * Post-verification onboarding (available before admin approval).
 * Fortify owns /auth/login, /auth/register, /auth/forgot-password,
 * /auth/two-factor-challenge, /auth/user/* and the email verification routes.
 */
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/auth/profile-setup', [ProfileSetupController::class, 'show'])->name('profile-setup');
    Route::post('/auth/profile-setup', [ProfileSetupController::class, 'store'])->name('profile-setup.store');

    Route::get('/auth/pending', fn (Request $request) => view('auth.pending', [
        'user' => $request->user(),
    ]))->name('pending');
});

/*
 * The security checklist: shown once, after an administrator approves the
 * account. Sits outside the 'onboarded' gate so it can't redirect to itself.
 */
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

Route::get('/auth/social/{provider}/callback', [SocialAuthController::class, 'callback'])
    ->name('social.callback');

Route::post('/auth/social/{provider}/disconnect', [SocialAuthController::class, 'disconnect'])
    ->middleware(['auth', 'verified'])
    ->name('social.disconnect');

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
