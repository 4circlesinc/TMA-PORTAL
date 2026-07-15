<?php

use App\Http\Middleware\ApplySecurityPolicyHeaders;
use App\Http\Middleware\EnforceTwoFactor;
use App\Http\Middleware\EnsureAccountApproved;
use App\Http\Middleware\EnsureOnboarded;
use App\Http\Middleware\IssueTrustedDeviceCookie;
use App\Http\Middleware\EnsureProfileComplete;
use App\Support\Files\FileValidationException;
use App\Support\Files\UploadConflictException;
use Illuminate\Foundation\Application;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'account.approved' => EnsureAccountApproved::class,
            'mfa.enforced' => EnforceTwoFactor::class,
            'profile.complete' => EnsureProfileComplete::class,
            'onboarded' => EnsureOnboarded::class,
        ]);

        $middleware->appendToGroup('web', ApplySecurityPolicyHeaders::class);
        $middleware->appendToGroup('web', IssueTrustedDeviceCookie::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // File-manager validation failures carry a specific, user-facing reason
        // (too large, unsafe type, name exists, …) — surface it as a 422 with
        // that exact message, never a generic error.
        $exceptions->render(function (FileValidationException $e, Request $request) {
            if ($request->is('portal/files/*') || $request->expectsJson()) {
                return response()->json(['message' => $e->getMessage()], 422);
            }

            return null;
        });

        // A duplicate-name upload asks the client how to resolve it (409).
        $exceptions->render(function (UploadConflictException $e, Request $request) {
            if ($request->is('portal/files/*') || $request->expectsJson()) {
                return response()->json([
                    'message' => $e->getMessage(),
                    'conflict' => true,
                    'existingName' => $e->existingName,
                    'suggestion' => $e->suggestion,
                ], 409);
            }

            return null;
        });

        // Expired/invalid signed email-verification links get the design's
        // "link expired" card instead of a bare 403.
        $exceptions->render(function (InvalidSignatureException $e, Request $request) {
            if ($request->routeIs('verification.verify')) {
                return response()->view('auth.verify-link-expired', [], 403);
            }

            return null;
        });
    })->create();
