<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Throwable;

class SocialAuthController extends Controller
{
    private const PROVIDERS = ['google'];

    public function redirect(Request $request, string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        if (! config("services.{$provider}.client_id")) {
            return $this->fail($request, ucfirst($provider).' sign-in is not configured yet.');
        }

        $request->session()->put('social.intent', $request->user() ? 'connect' : 'auth');

        return Socialite::driver($provider)
            ->with(['prompt' => 'select_account'])
            ->redirect();
    }

    public function callback(Request $request, string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        if ($request->has('error')) {
            return $this->fail($request, 'Connection cancelled - nothing was changed.');
        }

        try {
            /** @var OAuthUser $oauth */
            $oauth = Socialite::driver($provider)->user();
        } catch (Throwable) {
            return $this->fail($request, 'Sign-in with '.ucfirst($provider)." didn't complete. Please try again.");
        }

        $verified = $provider !== 'google' || (bool) ($oauth->user['email_verified'] ?? false);
        $intent = $request->session()->pull('social.intent', 'auth');

        if ($intent === 'connect' && $request->user()) {
            return $this->connect($request, $provider, $oauth, $verified);
        }

        return $this->authenticate($request, $provider, $oauth, $verified);
    }

    public function disconnect(Request $request, string $provider): JsonResponse|RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        $user = $request->user();
        $account = $user->connectedAccount($provider);

        if (! $account) {
            return $this->done($request, ucfirst($provider).' is not connected.', false);
        }

        if ($user->password_auto && $user->connectedAccounts->count() <= 1) {
            return $this->done($request, 'Set a password first so you can still sign in, then disconnect '.ucfirst($provider).'.', false);
        }

        $account->delete();
        $this->record($user->id, 'social_disconnected');

        return $this->done($request, ucfirst($provider).' disconnected.', true);
    }

    private function connect(Request $request, string $provider, OAuthUser $oauth, bool $verified): RedirectResponse
    {
        $user = $request->user();

        $existing = ConnectedAccount::where('provider', $provider)
            ->where('provider_id', $oauth->getId())
            ->first();

        if ($existing && $existing->user_id !== $user->id) {
            return $this->fail($request, 'That '.ucfirst($provider).' account is already connected to a different portal account.');
        }

        if (! $verified || ! Str::of($oauth->getEmail())->lower()->exactly(Str::lower($user->email))) {
            return $this->fail($request, "That ".ucfirst($provider)." account's email doesn't match your portal email.");
        }

        $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
        );

        $this->record($user->id, 'social_connected');

        return redirect()->route('security-settings')->with('status', 'social-connected');
    }

    private function authenticate(Request $request, string $provider, OAuthUser $oauth, bool $verified): RedirectResponse
    {
        $account = ConnectedAccount::where('provider', $provider)
            ->where('provider_id', $oauth->getId())
            ->first();

        if ($account) {
            return $this->login($request, $account->user);
        }

        if (! $verified) {
            return $this->fail($request, 'Your '.ucfirst($provider)." email isn't verified, so it can't be used to sign in.");
        }

        $user = User::where('email', Str::lower($oauth->getEmail()))->first();

        if (! $user) {
            $user = new User([
                'name' => $oauth->getName() ?: (string) Str::of($oauth->getEmail())->before('@'),
                'email' => Str::lower($oauth->getEmail()),
                'password' => Str::password(32),
            ]);
            $user->forceFill([
                'email_verified_at' => now(),
                'password_auto' => true,
            ])->save();

            $this->record($user->id, 'registered');
        }

        $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
        );

        // A Google-verified matching email also settles our own verification.
        if (! $user->hasVerifiedEmail()) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        return $this->login($request, $user);
    }

    private function login(Request $request, User $user): RedirectResponse
    {
        // Respect two-factor authentication: hand off to Fortify's challenge.
        if ($user->hasTwoFactorEnabled()) {
            $request->session()->put([
                'login.id' => $user->getKey(),
                'login.remember' => false,
            ]);

            return redirect()->route('two-factor.login');
        }

        Auth::login($user);
        $request->session()->regenerate();

        return redirect()->intended('/');
    }

    private function fail(Request $request, string $message): RedirectResponse
    {
        if ($request->user()) {
            return redirect()->route('security-settings')->with('social_error', $message);
        }

        return redirect()->route('login')->with('social_error', $message);
    }

    private function done(Request $request, string $message, bool $ok): JsonResponse|RedirectResponse
    {
        if ($request->wantsJson()) {
            return response()->json(['message' => $message], $ok ? 200 : 422);
        }

        return redirect()->route('security-settings')->with($ok ? 'status' : 'social_error', $ok ? 'social-disconnected' : $message);
    }

    private function record(?int $userId, string $event): void
    {
        AuthEvent::create([
            'user_id' => $userId,
            'event' => $event,
            'ip' => request()->ip(),
            'user_agent' => (string) request()->userAgent(),
            'created_at' => now(),
        ]);
    }
}
