<?php

use App\Http\Controllers\AdminSecurityController;
use App\Http\Controllers\AdminUsersController;
use App\Http\Controllers\ClientAssignmentController;
use App\Http\Controllers\ClientsController;
use App\Http\Controllers\ConnectorsController;
use App\Http\Controllers\FileLibraryController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DevDatabaseController;
use App\Http\Controllers\GettingStartedController;
use App\Http\Controllers\AvatarController;
use App\Http\Controllers\MeController;
use App\Http\Controllers\PreferencesController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProfileSetupController;
use App\Http\Controllers\SocialAuthController;
use App\Http\Controllers\LegacyPageController;
use App\Http\Controllers\MailController;
use App\Http\Controllers\SecuritySettingsController;
use App\Http\Controllers\Files\BrowserController;
use App\Http\Controllers\Files\BulkController;
use App\Http\Controllers\Files\FavoriteController;
use App\Http\Controllers\Files\FileController;
use App\Http\Controllers\Files\FolderController;
use App\Http\Controllers\Files\RecycleBinController;
use App\Http\Controllers\Files\UploadController;
use App\Http\Controllers\Signatures\PublicSigningController;
use App\Http\Controllers\Signatures\SignatureFieldController;
use App\Http\Controllers\Signatures\SignatureRequestController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Portal - requires login, verified email, and administrator approval.
 */
Route::middleware(['auth', 'verified', 'profile.complete', 'account.approved', 'onboarded', 'mfa.enforced'])->group(function () {
    Route::get('/', DashboardController::class);

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
        Route::get('/files/{uuid}/thumb', [\App\Http\Controllers\Files\ThumbnailController::class, 'show'])->name('thumb');

        Route::post('/uploads', [UploadController::class, 'init'])->name('uploads.init');
        Route::post('/uploads/{uuid}/chunk', [UploadController::class, 'chunk'])->name('uploads.chunk');
        Route::get('/uploads/{uuid}/status', [UploadController::class, 'status'])->name('uploads.status');
        Route::post('/uploads/{uuid}/complete', [UploadController::class, 'complete'])->name('uploads.complete');
        Route::delete('/uploads/{uuid}', [UploadController::class, 'abort'])->name('uploads.abort');

        Route::get('/shortcuts', [\App\Http\Controllers\Files\ShortcutController::class, 'index'])->name('shortcuts.index');
        Route::post('/shortcuts', [\App\Http\Controllers\Files\ShortcutController::class, 'store'])->name('shortcuts.store');
        Route::put('/shortcuts/reorder', [\App\Http\Controllers\Files\ShortcutController::class, 'reorder'])->name('shortcuts.reorder');
        Route::delete('/shortcuts/{uuid}', [\App\Http\Controllers\Files\ShortcutController::class, 'destroy'])->name('shortcuts.destroy');

        Route::post('/favorites/toggle', [FavoriteController::class, 'toggle'])->name('favorites.toggle');
        Route::post('/recycle-bin/empty', [RecycleBinController::class, 'empty'])->name('recycle.empty');
        Route::post('/bulk', [BulkController::class, 'handle'])->name('bulk');

        Route::get('/shares', [\App\Http\Controllers\Files\ShareController::class, 'index'])->name('shares.index');
        Route::post('/shares', [\App\Http\Controllers\Files\ShareController::class, 'store'])->name('shares.store');
        Route::patch('/shares/{uuid}', [\App\Http\Controllers\Files\ShareController::class, 'update'])->name('shares.update');
        Route::delete('/shares/{uuid}', [\App\Http\Controllers\Files\ShareController::class, 'destroy'])->name('shares.destroy');
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
Route::get('/s/{token}', [\App\Http\Controllers\Files\PublicShareController::class, 'show'])->name('share.show');
Route::post('/s/{token}/unlock', [\App\Http\Controllers\Files\PublicShareController::class, 'unlock'])->name('share.unlock');
Route::get('/s/{token}/preview', [\App\Http\Controllers\Files\PublicShareController::class, 'preview'])->name('share.preview');
Route::get('/s/{token}/download', [\App\Http\Controllers\Files\PublicShareController::class, 'download'])->name('share.download');
Route::get('/s/{token}/file/{fileUuid}', [\App\Http\Controllers\Files\PublicShareController::class, 'file'])->name('share.file');

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
