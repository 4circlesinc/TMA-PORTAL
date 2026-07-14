<?php

use App\Http\Controllers\AdminSecurityController;
use App\Http\Controllers\AdminUsersController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\SocialAuthController;
use App\Http\Controllers\LegacyPageController;
use App\Http\Controllers\SecuritySettingsController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Portal - requires login, verified email, and administrator approval.
 */
Route::middleware(['auth', 'verified', 'account.approved', 'mfa.enforced'])->group(function () {
    Route::get('/', DashboardController::class);

    Route::get('/security-settings', [SecuritySettingsController::class, 'show'])
        ->name('security-settings');

    Route::get('/security-settings/data', [SecuritySettingsController::class, 'data'])
        ->name('security-settings.data');

    Route::post('/security-settings/logout-others', [SecuritySettingsController::class, 'logoutOtherDevices'])
        ->name('security-settings.logout-others');

    Route::get('/admin/users', [AdminUsersController::class, 'index'])->name('admin.users');
    Route::post('/admin/users', [AdminUsersController::class, 'store'])->name('admin.users.store');
    Route::patch('/admin/users/{user}', [AdminUsersController::class, 'update'])->name('admin.users.update');
    Route::get('/admin/users/{user}/activity', [AdminUsersController::class, 'activity'])->name('admin.users.activity');
    Route::post('/admin/users/{user}/send-reset', [AdminUsersController::class, 'sendReset'])->name('admin.users.send-reset');
    Route::post('/admin/users/{user}/generate-password', [AdminUsersController::class, 'generatePassword'])->name('admin.users.generate-password');
    Route::post('/admin/users/{user}/approve', [AdminUsersController::class, 'approve'])->name('admin.users.approve');
    Route::post('/admin/users/{user}/suspend', [AdminUsersController::class, 'suspend'])->name('admin.users.suspend');
    Route::post('/admin/users/{user}/reactivate', [AdminUsersController::class, 'reactivate'])->name('admin.users.reactivate');

    Route::get('/admin/security-policies', [AdminSecurityController::class, 'show'])
        ->name('admin.security-policies');

    Route::put('/admin/security-policies/{section}', [AdminSecurityController::class, 'update'])
        ->name('admin.security-policies.update');

    Route::view('/demo/avatars', 'demo.avatars');

    Route::get('/{page}', LegacyPageController::class)
        ->whereIn('page', LegacyPageController::PORTAL_PAGES);
});

/*
 * Post-verification onboarding (available before admin approval).
 * Fortify owns /auth/login, /auth/register, /auth/forgot-password,
 * /auth/two-factor-challenge, /auth/user/* and the email verification routes.
 */
Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('/auth/getting-started', fn (Request $request) => view('auth.getting-started', [
        'user' => $request->user(),
    ]))->name('getting-started');

    Route::get('/auth/pending', fn (Request $request) => view('auth.pending', [
        'user' => $request->user(),
    ]))->name('pending');
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
