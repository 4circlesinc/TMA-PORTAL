<?php

use App\Http\Middleware\ApplySecurityPolicyHeaders;
use App\Http\Middleware\EnforceTwoFactor;
use App\Http\Middleware\EnsureAccountApproved;
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
        ]);

        $middleware->appendToGroup('web', ApplySecurityPolicyHeaders::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Expired/invalid signed email-verification links get the design's
        // "link expired" card instead of a bare 403.
        $exceptions->render(function (InvalidSignatureException $e, Request $request) {
            if ($request->routeIs('verification.verify')) {
                return response()->view('auth.verify-link-expired', [], 403);
            }

            return null;
        });
    })->create();
