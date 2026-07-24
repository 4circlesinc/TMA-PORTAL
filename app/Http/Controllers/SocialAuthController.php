<?php

namespace App\Http\Controllers;

use App\Jobs\AnalyzeMailbox;
use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\AvatarService;
use App\Support\TrustedDevices;
use GuzzleHttp\Exception\RequestException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\InvalidStateException;
use Laravel\Socialite\Two\User as OAuthUser;
use Throwable;

class SocialAuthController extends Controller
{
    private const PROVIDERS = ['google', 'microsoft'];

    private const SYNC_EXTRAS = ['email', 'calendar', 'onedrive', 'sharepoint'];

    public function redirect(Request $request, string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        if (! config("services.{$provider}.client_id")) {
            return $this->fail($request, ucfirst($provider).' sign-in is not configured yet.');
        }

        // Entra only accepts http://localhost (not 127.0.0.1) as a local
        // callback. If the provider's callback lives on the other loopback
        // name, hop there first so the session holding the OAuth state is
        // the one the callback lands on.
        $callback = (string) config("services.{$provider}.redirect");
        $callbackHost = parse_url($callback, PHP_URL_HOST);
        $loopbacks = ['localhost', '127.0.0.1'];

        if (
            $callbackHost
            && $callbackHost !== $request->getHost()
            && in_array($callbackHost, $loopbacks, true)
            && in_array($request->getHost(), $loopbacks, true)
        ) {
            $port = parse_url($callback, PHP_URL_PORT);

            return redirect()->away('http://'.$callbackHost.($port ? ':'.$port : '').$request->getRequestUri());
        }

        $request->session()->put('social.intent', $request->user() ? 'connect' : 'auth');
        $request->session()->put(
            'social.return',
            in_array($request->query('return'), ['getting-started', 'connectors', 'profile', 'email'], true) ? $request->query('return') : 'security-settings',
        );

        // Data sync opt-in (email, calendar, OneDrive, SharePoint). Only
        // requests extra scopes when the provider's sync is configured;
        // otherwise this is a normal sign-in.
        $extras = self::SYNC_EXTRAS;
        $wanted = [];
        foreach ($extras as $extra) {
            $wanted[$extra] = $request->boolean("sync_{$extra}");
            $request->session()->put("social.sync_{$extra}", $wanted[$extra]);
        }

        $driver = Socialite::driver($provider);
        $params = ['prompt' => 'select_account'];

        if (config("services.{$provider}.sync") && array_filter($wanted)) {
            $scopes = [];
            foreach ($extras as $extra) {
                if ($wanted[$extra] && $configured = config("services.{$provider}.scope_{$extra}")) {
                    // A capability can need more than one scope (Graph splits
                    // reading and sending), so each entry may list several.
                    $scopes = array_merge($scopes, preg_split('/\s+/', trim($configured)) ?: []);
                }
            }
            $driver->scopes(array_values(array_unique(array_filter($scopes))));

            if ($provider === 'google') {
                // needed to receive a refresh token for offline access
                $params = ['access_type' => 'offline', 'prompt' => 'consent'];
            } else {
                // offline_access is what makes Entra return a refresh token.
                // prompt=consent forces a fresh consent covering the newly
                // requested Mail scopes: without it, an account that already
                // signed in with basic scopes gets an incremental-consent token
                // limited to the *previously* granted scopes — a sign-in token
                // with no Mail.* and no refresh token, which reads as
                // "connected for reading only".
                $driver->scopes(['offline_access']);
                $params = ['prompt' => 'consent'];
            }
        }

        return $driver->with($params)->redirect();
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
        } catch (InvalidStateException $e) {
            // The state token in the callback didn't match the one we stored at
            // redirect — almost always a lost/expired session between the two
            // hops (cookie not persisting, wrong SESSION_DOMAIN, or the user
            // took too long / reused a stale link).
            Log::warning('Social sign-in state mismatch', [
                'provider' => $provider,
                'host' => $request->getHost(),
                'error' => $e->getMessage(),
            ]);

            return $this->fail($request, 'Your '.ucfirst($provider).' sign-in session expired. Please start again.');
        } catch (Throwable $e) {
            // Log the real cause: expired/invalid client secret, unregistered
            // redirect URI at token exchange, network failure to the token
            // endpoint, etc. The user sees a generic message; we don't.
            // When the provider's token endpoint answers with a 4xx (Guzzle
            // ClientException), the response body carries the precise reason —
            // e.g. AADSTS7000215 "Invalid client secret" — so capture it.
            $body = null;
            if ($e instanceof RequestException && $e->hasResponse()) {
                $body = Str::limit((string) $e->getResponse()->getBody(), 1000, '');
            }

            Log::error('Social sign-in failed', [
                'provider' => $provider,
                'host' => $request->getHost(),
                'exception' => $e::class,
                'error' => $e->getMessage(),
                'response' => $body,
            ]);

            return $this->fail($request, 'Sign-in with '.ucfirst($provider)." didn't complete. Please try again.");
        }

        $verified = match ($provider) {
            // Google supplies an explicit claim; Microsoft account emails
            // (personal MSA or Entra work accounts) are provider-verified.
            'google' => (bool) ($oauth->user['email_verified'] ?? false),
            'microsoft' => (bool) $oauth->getEmail(),
            default => false,
        };
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

        $account = $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            array_merge(
                ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
                $this->syncPayload($request, $oauth),
            ),
        );

        $this->startMailPipeline($account);

        $this->rememberAvatar($user, $oauth, $provider);

        $this->record($user->id, 'social_connected');

        $return = $request->session()->pull('social.return', 'security-settings');

        // Reconnecting specifically to pull the account photo: report whether we
        // actually found one so the profile page can say so.
        if ($return === 'profile') {
            $hasPhoto = (bool) $user->fresh()->provider_avatar_url;

            return redirect('/account-settings?page=profile&notice='.($hasPhoto ? 'photo-added' : 'photo-none'));
        }

        return $this->returnTo($return, true, 'social-connected');
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
            $display = $oauth->getName() ?: (string) Str::of($oauth->getEmail())->before('@');
            $parts = preg_split('/\s+/', trim($display), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $first = array_shift($parts) ?: $display;
            $last = count($parts) ? array_pop($parts) : null;

            $user = new User([
                'name' => $display,
                'first_name' => $first,
                'middle_name' => count($parts) ? implode(' ', $parts) : null,
                'last_name' => $last,
                'email' => Str::lower($oauth->getEmail()),
                'password' => Str::password(32),
            ]);
            $user->forceFill([
                'email_verified_at' => now(),
                'password_auto' => true,
            ])->save();

            $this->record($user->id, 'registered');
        }

        $account = $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            array_merge(
                ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
                $this->syncPayload($request, $oauth),
            ),
        );

        $this->startMailPipeline($account);

        // A Google-verified matching email also settles our own verification.
        if (! $user->hasVerifiedEmail()) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        $this->rememberAvatar($user, $oauth, $provider);

        return $this->login($request, $user);
    }

    private function login(Request $request, User $user): RedirectResponse
    {
        // Respect two-factor authentication: hand off to Fortify's challenge,
        // unless this is a device the user already trusted.
        if ($user->hasTwoFactorEnabled() && ! TrustedDevices::trusts($user, $request)) {
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

    /**
     * The moment mail sync is (re)enabled, start the analyze → import
     * pipeline so the user sees mailbox totals within seconds of landing
     * back on the portal — not after the whole import. Guarded because on a
     * synchronous queue this runs inline, and a provider hiccup must not
     * break the OAuth callback; the progress record carries any failure.
     */
    private function startMailPipeline(ConnectedAccount $account): void
    {
        if (! $account->sync_email || ! $account->token) {
            return;
        }

        // Only an actual (re)connection lands in the audit trail — a plain
        // social sign-in that happens to carry the same grant does not.
        if ($account->wasRecentlyCreated || $account->wasChanged('sync_email') || $account->wasChanged('token')) {
            $providerName = ucfirst($account->provider);

            \App\Support\Activity\ActivityLogger::log([
                'actor' => $account->user_id,
                'type' => 'email.connected',
                'description' => ($account->user?->name ?? 'A user').' connected their '.$providerName.' mailbox',
                'subject' => $account,
            ]);

            \App\Support\Notifications\Notifier::send([
                'user' => $account->user_id,
                'type' => 'security.account_connected',
                'title' => $providerName.' mailbox connected',
                'message' => $account->email.' — import is starting in the background.',
                'action_url' => '/email',
                'dedupe_key' => 'mailbox.connected:'.$account->id,
            ]);
        }

        rescue(function () use ($account) {
            AnalyzeMailbox::start($account);
        }, report: false);
    }

    private function returnTo(string $return, bool $ok, string $message): RedirectResponse
    {
        if ($return === 'email') {
            // Connecting from the email page goes back to the email page —
            // the progress panel there picks the sync up immediately.
            return redirect('/email?notice='.($ok ? 'mail-connected' : 'mail-error&reason='.urlencode($message)));
        }

        if ($return === 'connectors') {
            return redirect('/account-settings?settings-page=connectors&notice='.($ok ? 'social-connected' : 'social-error')
                .($ok ? '' : '&reason='.urlencode($message)));
        }

        if ($return === 'profile') {
            return redirect('/account-settings?page=profile'.($ok ? '&notice=photo-added' : '&notice=social-error&reason='.urlencode($message)));
        }

        $route = $return === 'getting-started' ? 'getting-started' : 'security-settings';

        return redirect()->route($route)->with($ok ? 'status' : 'social_error', $ok ? 'social-connected' : $message);
    }

    private function fail(Request $request, string $message): RedirectResponse
    {
        if ($request->user()) {
            return $this->returnTo(
                $request->session()->pull('social.return', 'security-settings'),
                false,
                $message,
            );
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

    /**
     * Refresh token + granted scopes + sync flags to persist on the connected
     * account, only when the user opted into sync and we received a token.
     */
    private function syncPayload(Request $request, OAuthUser $oauth): array
    {
        $wanted = [];
        foreach (self::SYNC_EXTRAS as $extra) {
            $wanted[$extra] = (bool) $request->session()->pull("social.sync_{$extra}", false);
        }

        if (! array_filter($wanted)) {
            return [];
        }

        $granted = $oauth->accessTokenResponseBody['scope'] ?? '';

        return [
            'token' => $oauth->refreshToken ?: null,
            'scopes' => $granted ? explode(' ', $granted) : null,
            'sync_email' => $wanted['email'],
            'sync_calendar' => $wanted['calendar'],
            'sync_onedrive' => $wanted['onedrive'],
            'sync_sharepoint' => $wanted['sharepoint'],
        ];
    }

    /**
     * Remember the provider's profile photo so the user can keep it instead of
     * uploading. Google hands us a public image URL; for Microsoft we pull the
     * photo bytes from Graph ourselves and store them as a file we can serve.
     */
    private function rememberAvatar(User $user, OAuthUser $oauth, string $provider): void
    {
        $oldProvider = (string) $user->provider_avatar_url;
        $providerUrl = null;

        if ($provider === 'microsoft') {
            $bytes = $this->fetchMicrosoftPhoto($oauth);
            if ($bytes !== null) {
                $providerUrl = AvatarService::storeBinary($bytes, $oldProvider);
            }
        } else {
            $avatar = $oauth->getAvatar();
            if ($avatar && str_starts_with($avatar, 'https://')) {
                // A public URL (Google). Drop any file we stored for a previous
                // provider photo so it doesn't orphan.
                AvatarService::deletePrevious($oldProvider);
                $providerUrl = $avatar;
            }
        }

        if (! $providerUrl) {
            return;
        }

        $current = (string) $user->avatar_url;
        // Adopt the provider photo unless they've set a *real* photo of their own
        // (an uploaded /storage/ file or another https URL). Empty values and
        // legacy system-avatar names count as "no real photo".
        $hasRealPhoto = str_starts_with($current, '/storage/')
            || str_starts_with($current, '/media/')
            || (str_starts_with($current, 'https://') && $current !== $oldProvider);
        $wasUsingProviderPhoto = ! $hasRealPhoto || $current === $oldProvider;

        $fill = ['provider_avatar_url' => $providerUrl];
        if ($wasUsingProviderPhoto) {
            $fill['avatar_url'] = $providerUrl;
        }

        $user->forceFill($fill)->save();
    }

    /**
     * Fetch the signed-in Microsoft user's profile photo bytes from Graph.
     * Uses the unsized /me/photo/$value endpoint, which works for both
     * work/school and personal accounts (the sized /photos/{size} endpoint the
     * Socialite driver uses 404s on many accounts). Returns null if there's no
     * photo or the call fails.
     */
    private function fetchMicrosoftPhoto(OAuthUser $oauth): ?string
    {
        // If the driver already supplied base64 photo bytes, use them.
        $existing = $oauth->getAvatar();
        if ($existing && ! str_starts_with($existing, 'http')) {
            $bin = base64_decode($existing, true);
            if ($bin !== false && $bin !== '') {
                return $bin;
            }
        }

        $token = $oauth->token ?? null;
        if (! $token) {
            return null;
        }

        try {
            $resp = Http::withToken($token)
                ->withHeaders(['Accept' => 'image/jpeg'])
                ->get('https://graph.microsoft.com/v1.0/me/photo/$value');

            if ($resp->successful() && $resp->body() !== '') {
                return $resp->body();
            }

            Log::info('Microsoft photo unavailable', ['status' => $resp->status()]);
        } catch (Throwable $e) {
            Log::info('Microsoft photo fetch error', ['error' => $e->getMessage()]);
        }

        return null;
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
