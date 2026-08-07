<?php

namespace App\Http\Controllers;

use App\Jobs\AnalyzeMailbox;
use App\Jobs\ImportProviderCalendars;
use App\Jobs\ProvisionPersonalOneDrive;
use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\AvatarService;
use App\Support\Notifications\Notifier;
use App\Support\StaySignedIn;
use App\Support\TrustedDevices;
use GuzzleHttp\Exception\RequestException;
use Illuminate\Auth\Events\Registered;
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

        // Remember where the user came from *before* anything can fail.
        // These used to be written further down, after the configuration
        // check, so a provider with no client id fell back to the default
        // return of 'security-settings' — which is why "Connect Google" on the
        // onboarding screen dumped people in Account settings instead of
        // leaving them on onboarding with the reason.
        $request->session()->put('social.intent', $request->user() ? 'connect' : 'auth');
        $request->session()->put(
            'social.return',
            in_array($request->query('return'), ['getting-started', 'connectors', 'profile', 'email', 'calendar', 'onboarding'], true) ? $request->query('return') : 'security-settings',
        );

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

        // Data sync opt-in (email, calendar, OneDrive, SharePoint). Only
        // requests extra scopes when the provider's sync is configured;
        // otherwise this is a normal sign-in.
        //
        // One consent covers everything: sync_all expands to every capability
        // the provider has scopes for, and a connect for one capability always
        // re-includes whatever the account already syncs — so reconnecting the
        // mailbox can never switch the calendar or OneDrive off again.
        $account = $request->user()?->connectedAccount($provider);

        $extras = self::SYNC_EXTRAS;
        $all = $request->boolean('sync_all');
        $wanted = [];
        foreach ($extras as $extra) {
            $wanted[$extra] = ($all || $request->boolean("sync_{$extra}") || (bool) $account?->{"sync_{$extra}"})
                && (bool) config("services.{$provider}.scope_{$extra}");
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

            // prompt=consent replaces the old grant wholesale, so also
            // re-request every scope the account was already granted —
            // otherwise a narrow reconnect silently drops the rest.
            $scopes = array_merge($scopes, $account?->scopes ?? []);

            $driver->scopes(array_values(array_unique(array_filter($scopes))));

            if ($provider === 'google') {
                // needed to receive a refresh token for offline access
                $params = ['access_type' => 'offline', 'prompt' => 'consent'];
            } else {
                // offline_access is what makes Entra return a refresh token.
                //
                // No prompt=consent here. Consent is granted tenant-wide by an
                // administrator (Entra → TMA Portal → API permissions → Grant
                // admin consent), and forcing a fresh per-user consent sends
                // every non-admin to Microsoft's "Need admin approval" wall —
                // users in the firm's tenant may not self-consent at all, so
                // the existing grant can never satisfy a forced re-consent.
                // A scope that genuinely lacks consent still surfaces
                // Microsoft's own consent screen without the prompt; a token
                // that comes back narrower than asked is caught by
                // canSyncMail()/canWriteCalendar() and the UI asks to
                // reconnect.
                $driver->scopes(['offline_access']);
            }
        }

        return $driver->with($params)->redirect();
    }

    public function callback(Request $request, string $provider): RedirectResponse
    {
        abort_unless(in_array($provider, self::PROVIDERS, true), 404);

        // A provider that turns someone away reports it here rather than by
        // throwing, and the reason is the only thing separating "I changed my
        // mind" from "this tenant will not allow it without an administrator".
        // Discarding it — as this did — leaves the person on the sign-in screen
        // being told they cancelled something they did not, with nothing in the
        // log to contradict them, so the only move left is to try again and be
        // refused identically. Entra refuses this way for a whole class of
        // policy reasons, none of which the user can fix by retrying.
        if ($request->has('error')) {
            $error = (string) $request->query('error');
            $description = (string) $request->query('error_description');

            Log::warning('Social sign-in refused by provider', [
                'provider' => $provider,
                'host' => $request->getHost(),
                'error' => $error,
                'error_subcode' => (string) $request->query('error_subcode'),
                // Lifted out of the description so refusals can be counted and
                // grepped by cause — the description itself carries a unique
                // trace id and timestamp, so no two are ever the same string.
                'aadsts' => self::refusalCodes($description),
                'error_description' => Str::limit($description, 500, ''),
            ]);

            return $this->fail($request, $this->refusalMessage($provider, $error, $description));
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
            return $this->fail($request, 'That '.ucfirst($provider)." account's email doesn't match your portal email.");
        }

        $account = $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            array_merge(
                ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
                $this->syncPayload($request, $oauth, $user->connectedAccount($provider)),
            ),
        );

        $this->startMailPipeline($account);
        $this->startCalendarPipeline($account);
        $this->startOneDrivePipeline($account);

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
            // A deleted account keeps its row in the Recycle Bin, so its
            // connected accounts still resolve - but the relation is filtered
            // by the soft-delete scope and comes back null. Say what happened
            // rather than dying on it.
            return $account->user
                ? $this->login($request, $account->user)
                : $this->fail($request, 'That account has been removed. Ask an administrator to restore it.');
        }

        if (! $verified) {
            return $this->fail($request, 'Your '.ucfirst($provider)." email isn't verified, so it can't be used to sign in.");
        }

        $email = Str::lower($oauth->getEmail());

        // Look past the soft-delete scope before deciding to register: the
        // address is still taken by the deleted row, so creating a second
        // account here would only break on the unique index.
        $deleted = User::onlyTrashed()->where('email', $email)->first();
        if ($deleted) {
            return $this->fail($request, 'That account has been removed. Ask an administrator to restore it.');
        }

        $user = User::where('email', $email)->first();

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
                'email' => $email,
                'password' => Str::password(32),
            ]);
            $user->forceFill([
                'email_verified_at' => now(),
                'password_auto' => true,
            ])->save();

            // The real Registered event, not a bare auth_events row. Signing up
            // with Google or Microsoft is still signing up: it has to alert the
            // administrators, land in the audit trail and email the person that
            // their request is pending, exactly as the password form does.
            // RecordAuthEvent::handleRegistered writes the auth_events row, so
            // recording it here as well would double-count it.
            event(new Registered($user));
        }

        $account = $user->connectedAccounts()->updateOrCreate(
            ['provider' => $provider],
            array_merge(
                ['provider_id' => $oauth->getId(), 'email' => $oauth->getEmail(), 'name' => $oauth->getName()],
                $this->syncPayload($request, $oauth, $user->connectedAccounts()->where('provider', $provider)->first()),
            ),
        );

        $this->startMailPipeline($account);
        $this->startCalendarPipeline($account);
        $this->startOneDrivePipeline($account);

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
        // unless this is a device the user already trusted. Remember-me is
        // applied in StaySignedIn::afterAuthenticated when the browser already
        // chose to stay signed in (or on the stay-signed-in prompt).
        if ($user->hasTwoFactorEnabled() && ! TrustedDevices::trusts($user, $request)) {
            $request->session()->put([
                'login.id' => $user->getKey(),
                'login.remember' => StaySignedIn::wantsRemember($request),
            ]);

            return redirect()->route('two-factor.login');
        }

        Auth::login($user, false);
        $request->session()->regenerate();

        if ($redirect = StaySignedIn::afterAuthenticated($request)) {
            return $redirect;
        }

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

            ActivityLogger::log([
                'actor' => $account->user_id,
                'type' => 'email.connected',
                'description' => ($account->user?->name ?? 'A user').' connected their '.$providerName.' mailbox',
                'subject' => $account,
            ]);

            Notifier::send([
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

    /**
     * Mirror every calendar the account can see as soon as calendar sync is
     * (re)enabled — the user should never have to find a "Connect all"
     * button. The import skips calendars that are already mirrored.
     */
    private function startCalendarPipeline(ConnectedAccount $account): void
    {
        if (! $account->sync_calendar || ! $account->token || ! $account->canReadCalendar()) {
            return;
        }

        if ($account->wasRecentlyCreated || $account->wasChanged('sync_calendar') || $account->wasChanged('token')) {
            rescue(function () use ($account) {
                ImportProviderCalendars::dispatch($account->id);
            }, report: false);
        }
    }

    /**
     * Link the person's own OneDrive into their file library the moment they
     * connect Microsoft. The job is idempotent and quietly skips clients,
     * personal (non-tenant) accounts, and drives that are already connected.
     */
    private function startOneDrivePipeline(ConnectedAccount $account): void
    {
        if ($account->provider !== 'microsoft' || ! $account->sync_onedrive || ! $account->token) {
            return;
        }

        if ($account->wasRecentlyCreated || $account->wasChanged('sync_onedrive') || $account->wasChanged('token')) {
            rescue(function () use ($account) {
                ProvisionPersonalOneDrive::dispatch($account->id);
            }, report: false);
        }
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

        if ($return === 'calendar') {
            return redirect('/calendar?notice='.($ok ? 'social-connected' : 'social-error&reason='.urlencode($message)));
        }

        if ($return === 'onboarding') {
            // Back into the client wizard, which resumes at the next
            // unfinished step.
            return redirect()->route('onboarding.index')->with($ok ? 'status' : 'social_error', $ok ? 'social-connected' : $message);
        }

        $route = $return === 'getting-started' ? 'getting-started' : 'security-settings';

        return redirect()->route($route)->with($ok ? 'status' : 'social_error', $ok ? 'social-connected' : $message);
    }

    /**
     * The AADSTS codes Entra reports a refusal with. They arrive inside
     * error_description rather than as a field of their own, and one
     * description can carry several.
     *
     * @return list<string>
     */
    private static function refusalCodes(string $description): array
    {
        preg_match_all('/AADSTS(\d+)/', $description, $matches);

        return array_values(array_unique($matches[1]));
    }

    /**
     * @param  list<string>  $codes
     */
    private static function anyCode(array $codes, string $pattern): bool
    {
        foreach ($codes as $code) {
            if (preg_match($pattern, $code)) {
                return true;
            }
        }

        return false;
    }

    /**
     * What to tell someone a provider turned away.
     *
     * "Cancelled" is only true when they cancelled. A Microsoft 365 tenant that
     * restricts which apps its people may consent to refuses with the same
     * shape, and so does a blocked or conditional-access-gated account — and in
     * every one of those cases the fix belongs to their administrator, not to
     * them. Telling that person they cancelled sends them round the same loop
     * indefinitely, because retrying is precisely what cannot work.
     *
     * Naming only a handful of codes was nearly as bad: everything else landed
     * on one catch-all that named no cause at all, so the single most common
     * refusal a *new* person meets — 50105, the account was never assigned to
     * the app — was indistinguishable from a misconfigured client secret. A
     * tenant can sign its existing staff in happily for months while turning
     * every new starter away, and nothing on the screen or in the log said
     * which setting to look at.
     *
     * Order matters: the specific causes are tested before the general ones.
     */
    private function refusalMessage(string $provider, string $error, string $description): string
    {
        $name = ucfirst($provider);
        $codes = self::refusalCodes($description);

        // 50105: the app has "user assignment required" switched on and this
        // account is not in the assigned list. Nothing is wrong with their
        // account, the portal, or the consent — an administrator simply has to
        // add them. This is what breaks new starters and only new starters.
        if (self::anyCode($codes, '/^50105$/')) {
            return 'Your '.$name." administrator hasn't given your account access to the portal yet.";
        }

        // 65001: no consent recorded for this app. 90094 / 900941: the grant
        // needs an administrator to give it.
        if (
            $error === 'consent_required'
            || $error === 'admin_consent_required'
            || self::anyCode($codes, '/^(65001|90094|900941)$/')
        ) {
            return 'Your '.$name.' administrator needs to approve the portal before you can sign in this way.';
        }

        // 65004 is returned both when someone declines a consent screen and
        // when they are bounced off Microsoft's "Need admin approval" wall,
        // and the two are indistinguishable from here. Cover both rather than
        // accuse someone of cancelling a choice they were never offered.
        if (self::anyCode($codes, '/^65004$/')) {
            return $name." sign-in wasn't approved - if you weren't offered a choice, your administrator has to approve the portal.";
        }

        // The account is not a member of the organisation this portal signs
        // people in from, so no amount of retrying or approving will help.
        if (self::anyCode($codes, '/^(50020|50128|50129)$/')) {
            return 'That '.$name." account isn't part of the organisation the portal signs people in from.";
        }

        // Conditional access, device compliance, MFA policy, risky sign-in.
        // "Approve the portal" is the wrong advice here — the block is on the
        // sign-in itself, not on the app.
        if (self::anyCode($codes, '/^(50005|50076|50079|50158|53\d{3})$/')) {
            return "Your organisation's security policy blocked this sign-in - your ".$name.' administrator can say why.';
        }

        // The Microsoft account itself is disabled, locked or expired.
        if (self::anyCode($codes, '/^(50053|50055|50057|50058)$/')) {
            return 'That '.$name.' account cannot sign in at the moment - check it with your '.$name.' administrator.';
        }

        // Ours to fix, not theirs: a redirect URI, requested permission or
        // credential on the app registration is wrong. Sending these people to
        // their own administrator wastes everybody's time — nothing in their
        // tenant can put it right.
        if (
            in_array($error, ['unauthorized_client', 'invalid_client', 'invalid_request'], true)
            || self::anyCode($codes, '/^(50011|500011|650056|650057|700016|900971|7000112|7000215|7000222)$/')
        ) {
            return "The portal's ".$name.' connection needs attention - please contact support.';
        }

        // A genuine "no" from the person in front of the consent screen. Only
        // when the provider gave no code at all: every refusal that carries one
        // has a cause behind it that the person did not choose.
        if ($error === 'access_denied' && $codes === []) {
            return $name.' sign-in was cancelled - nothing was changed.';
        }

        // Anything we have not named. The code is the only thing that makes it
        // diagnosable, so put it where the person can read it back to support
        // rather than leaving it in a log nobody can reach.
        return $name.' sign-in was refused'.($codes ? ' (AADSTS'.$codes[0].')' : '')
            .". Ask an administrator to check the portal's ".$name.' access.';
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
     *
     * Merges with what the account already holds: a connect launched for one
     * capability must never switch another one off, wipe the stored refresh
     * token, or blank the granted scopes. Turning sync off is an explicit
     * disconnect, not a side effect of connecting.
     */
    private function syncPayload(Request $request, OAuthUser $oauth, ?ConnectedAccount $existing = null): array
    {
        $wanted = [];
        foreach (self::SYNC_EXTRAS as $extra) {
            $wanted[$extra] = (bool) $request->session()->pull("social.sync_{$extra}", false);
        }

        if (! array_filter($wanted)) {
            return [];
        }

        $payload = [
            'sync_email' => $wanted['email'] || (bool) $existing?->sync_email,
            'sync_calendar' => $wanted['calendar'] || (bool) $existing?->sync_calendar,
            'sync_onedrive' => $wanted['onedrive'] || (bool) $existing?->sync_onedrive,
            'sync_sharepoint' => $wanted['sharepoint'] || (bool) $existing?->sync_sharepoint,
        ];

        // The granted scopes are the provider's word on what the new token can
        // do — store them as-is when present (the redirect re-requested every
        // previously held scope, so they only ever grow), keep the old list
        // when the response omits them.
        $granted = $oauth->accessTokenResponseBody['scope'] ?? '';
        if ($granted) {
            $payload['scopes'] = explode(' ', $granted);
        }

        // A consent that came back without a refresh token must not erase the
        // one we hold.
        if ($oauth->refreshToken) {
            $payload['token'] = $oauth->refreshToken;
        }

        return $payload;
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
