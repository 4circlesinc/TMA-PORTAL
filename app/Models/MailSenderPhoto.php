<?php

namespace App\Models;

use App\Jobs\ResolveSenderPhoto;
use App\Support\Mail\Mailbox;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * A cached profile photo for someone who sends you mail.
 *
 * Two sources, tried in order: the mail provider's directory (a real photo for
 * a colleague in your own organisation) and, failing that, the sender domain's
 * brand logo (so PayPal, your bank, a newsletter show their mark instead of
 * initials). A sender with neither is cached as a miss and drawn as initials —
 * no invented pictures.
 */
#[Fillable(['hash', 'email', 'connected_account_id', 'disk', 'path', 'mime', 'has_photo', 'source', 'checked_at'])]
class MailSenderPhoto extends Model
{
    /** How long before we ask the provider about a sender again. */
    private const HIT_TTL_DAYS = 30;

    private const MISS_TTL_DAYS = 7;

    /**
     * Personal mailbox domains. A sender here is an individual, not a brand, so
     * we never hang the domain's logo on them — that would put the Gmail mark
     * on every gmail.com contact. They fall through to initials (or their
     * portal photo, if they have an account).
     */
    private const CONSUMER_DOMAINS = [
        'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
        'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
        'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
    ];

    protected function casts(): array
    {
        return [
            'has_photo' => 'boolean',
            'checked_at' => 'datetime',
        ];
    }

    public static function hashFor(string $email): string
    {
        return hash('sha256', mb_strtolower(trim($email)));
    }

    public function isFresh(): bool
    {
        if (! $this->checked_at) {
            return false;
        }

        // Brand favicons are a weak inbox fallback — keep them fresh for a
        // shorter window so directory / Gravatar can still win for faces.
        $ttl = match (true) {
            $this->source === 'brand' => self::MISS_TTL_DAYS,
            $this->has_photo => self::HIT_TTL_DAYS,
            default => self::MISS_TTL_DAYS,
        };

        return $this->checked_at->gt(now()->subDays($ttl));
    }

    /**
     * The cached photo, read-only — never touches the provider. Used by
     * request-time code (page render, the serving endpoint) so nothing in the
     * HTTP path can block on a live call to Microsoft or Google.
     *
     * @return array{body:string, mime:string}|null
     */
    public static function cachedOnly(string $email): ?array
    {
        $row = self::where('hash', self::hashFor($email))->first();

        if (! $row || ! $row->isFresh()) {
            return null;
        }

        return $row->has_photo ? $row->read() : null;
    }

    /**
     * Public URL for a cached sender image (face or brand logo), or null.
     * Used by the inbox list. Prefer {@see faceUrlFor} for notification
     * avatars — brand favicons look wrong cropped into a face circle.
     */
    public static function urlFor(string $email): ?string
    {
        return self::urlForRow(self::rowFor($email));
    }

    /**
     * Public URL for a *person* photo only (directory / Gravatar). Brand
     * favicons and ambiguous legacy PNGs are excluded so notification toasts
     * never show a weird cropped company mark.
     */
    public static function faceUrlFor(string $email): ?string
    {
        $row = self::rowFor($email);
        if (! $row || ! $row->isFacePhoto()) {
            return null;
        }

        return self::urlForRow($row);
    }

    public function isFacePhoto(): bool
    {
        if (! $this->has_photo) {
            return false;
        }

        if ($this->source === 'brand') {
            return false;
        }

        if (in_array($this->source, ['directory', 'gravatar'], true)) {
            return true;
        }

        // Legacy rows (no source yet). Directory photos were always stored as
        // jpeg by resolve(); Google favicons are almost always tiny png/ico.
        // Treat substantial jpegs as faces; tiny png/gif/ico as brand marks.
        $mime = mb_strtolower((string) $this->mime);
        if (str_starts_with($mime, 'image/jpeg') || $mime === 'image/jpg') {
            return true;
        }

        return false;
    }

    private static function rowFor(string $email): ?self
    {
        $email = mb_strtolower(trim($email));
        if ($email === '' || ! str_contains($email, '@')) {
            return null;
        }

        $row = self::where('hash', self::hashFor($email))->first();
        if (! $row || ! $row->isFresh() || ! $row->has_photo) {
            return null;
        }

        return $row;
    }

    /**
     * Relative portal URL so avatars keep working when APP_URL host/port
     * differs from the browser's address bar.
     */
    private static function urlForRow(?self $row): ?string
    {
        return $row ? '/portal/mail/sender-photo/'.$row->hash : null;
    }

    /**
     * Expire cached brand favicons / ambiguous legacy pngs so the next
     * ResolveSenderPhoto run can replace them with a real directory face.
     */
    public static function expireNonFaceCaches(): int
    {
        return self::query()
            ->where('has_photo', true)
            ->where(function ($q) {
                $q->where('source', 'brand')
                    ->orWhere(function ($inner) {
                        $inner->whereNull('source')
                            ->where(function ($mime) {
                                $mime->where('mime', 'like', '%png%')
                                    ->orWhere('mime', 'like', '%icon%')
                                    ->orWhere('mime', 'like', '%gif%')
                                    ->orWhere('path', 'like', '%.ico')
                                    ->orWhere('path', 'like', '%.png');
                            });
                    });
            })
            ->update([
                'source' => 'brand',
                // Must be older than HIT_TTL — these rows still have has_photo=true.
                'checked_at' => now()->subDays(self::HIT_TTL_DAYS + 1),
                'updated_at' => now(),
            ]);
    }

    /**
     * True when a background resolve is worth queuing for a *face* avatar
     * (notifications / toasts). Brand-only caches count as unresolved faces.
     */
    public static function needsFaceResolve(string $email): bool
    {
        $email = mb_strtolower(trim($email));
        if ($email === '' || ! str_contains($email, '@')) {
            return false;
        }

        $row = self::where('hash', self::hashFor($email))->first();
        if (! $row) {
            return true;
        }

        if ($row->isFacePhoto() && $row->isFresh()) {
            return false;
        }

        // Fresh miss — wait out the miss TTL before asking again.
        if (! $row->has_photo && $row->isFresh()) {
            return false;
        }

        // Brand logos are not faces. Retry directory/Gravatar only after the
        // shorter brand freshness window has ended (avoids queue spam).
        if ($row->source === 'brand') {
            return ! $row->isFresh();
        }

        return ! $row->isFresh();
    }

    /**
     * True when nobody has asked the provider about this address recently -
     * i.e. a background resolve is worth queuing. Cheap: one indexed lookup,
     * no network.
     */
    public static function needsBackgroundResolve(string $email): bool
    {
        $row = self::where('hash', self::hashFor($email))->first();

        return ! $row || ! $row->isFresh();
    }

    /**
     * Fetch and cache a sender's photo from the provider.
     *
     * This is the one place that calls the provider for a photo, and it must
     * only ever run on the queue ({@see ResolveSenderPhoto}) - a
     * mailbox can reference dozens of distinct senders on one page, and
     * blocking a web request (or worse, an <img> load) on that many live Graph
     * round trips is what took the mailbox down the first time this shipped.
     *
     * @return array{body:string, mime:string}|null
     */
    public static function resolve(ConnectedAccount $account, string $email): ?array
    {
        $hash = self::hashFor($email);
        $row = self::where('hash', $hash)->first();

        if ($row && $row->isFresh()) {
            // A fresh brand logo is not a face. Fall through so directory /
            // Gravatar can still run when brand freshness has ended (see
            // isFresh brand TTL) — but while brand is "fresh", skip network.
            if ($row->source === 'brand') {
                return null;
            }

            return $row->has_photo ? $row->read() : null;
        }

        // Directory / contacts first — a real face from the mailbox provider.
        // When the primary mailbox is Microsoft, Gmail faces are unreachable
        // via Graph; if this user also linked Google, try that next for the
        // same address. Then Gravatar. Company-domain brand logos are last,
        // and never for same-organisation addresses (those must stay as
        // initials until a real directory face exists — favicons are not faces).
        $photo = null;
        $source = null;
        try {
            $bytes = Mailbox::provider($account)->photoFor($email);
            if ($bytes !== null && $bytes !== '') {
                $photo = ['body' => $bytes, 'mime' => 'image/jpeg'];
                $source = 'directory';
            }
        } catch (Throwable) {
            // A provider error is a miss for now; the TTL brings us back.
        }

        if ($photo === null && $account->provider === 'microsoft') {
            $google = ConnectedAccount::query()
                ->where('user_id', $account->user_id)
                ->where('provider', 'google')
                ->whereNotNull('token')
                ->latest('updated_at')
                ->first();
            if ($google) {
                try {
                    $bytes = Mailbox::provider($google)->photoFor($email);
                    if ($bytes !== null && $bytes !== '') {
                        $photo = ['body' => $bytes, 'mime' => 'image/jpeg'];
                        $source = 'directory';
                    }
                } catch (Throwable) {
                    // Soft miss — fall through to Gravatar.
                }
            }
        }

        if ($photo === null) {
            $photo = self::gravatarFor($email);
            if ($photo !== null) {
                $source = 'gravatar';
            }
        }

        if ($photo === null && ! self::sameOrgAs($account, $email)) {
            $photo = self::brandLogoFor($email);
            if ($photo !== null) {
                $source = 'brand';
            }
        }

        $row ??= new self(['hash' => $hash, 'email' => mb_strtolower(trim($email))]);
        $row->connected_account_id = $account->id;
        $row->checked_at = now();

        if ($photo === null) {
            $row->has_photo = false;
            $row->source = null;
            $row->save();

            return null;
        }

        $ext = match ($photo['mime']) {
            'image/png' => 'png',
            'image/x-icon', 'image/vnd.microsoft.icon' => 'ico',
            'image/gif' => 'gif',
            default => 'jpg',
        };
        $disk = config('filesystems.avatar_disk', config('filesystems.default'));
        $path = 'mail-sender-photos/'.$hash.'.'.$ext;
        Storage::disk($disk)->put($path, $photo['body']);

        $row->forceFill([
            'disk' => $disk,
            'path' => $path,
            'mime' => $photo['mime'],
            'has_photo' => true,
            'source' => $source,
        ])->save();

        return $photo;
    }

    /**
     * Gravatar for personal addresses (Gmail, Yahoo, iCloud, …).
     *
     * Microsoft and Google will not hand out arbitrary consumer profile
     * photos by email — privacy policy. Gravatar is the one public opt-in
     * directory people actually use for that. `d=404` means "no avatar"
     * returns a real miss instead of the mystery-person silhouette.
     *
     * @return array{body:string, mime:string}|null
     */
    private static function gravatarFor(string $email): ?array
    {
        $email = mb_strtolower(trim($email));
        if ($email === '' || ! str_contains($email, '@')) {
            return null;
        }

        $hash = md5($email);

        try {
            $response = Http::timeout(6)->get('https://www.gravatar.com/avatar/'.$hash, [
                's' => 128,
                'd' => '404',
                'r' => 'pg',
            ]);
        } catch (Throwable) {
            return null;
        }

        $mime = trim(explode(';', strtolower((string) $response->header('Content-Type')))[0]);

        if ($response->status() === 404 || ! $response->successful() || $response->body() === '' || ! str_starts_with($mime, 'image/')) {
            return null;
        }

        return ['body' => $response->body(), 'mime' => $mime ?: 'image/jpeg'];
    }

    /**
     * A brand logo for an external sender, keyed on the email domain.
     *
     * Runs only on the queue (via {@see resolve}): one outbound call to a logo
     * service, returning the raw image or null when there is no logo — a null
     * is cached as a miss like any other. Personal mailbox domains are skipped;
     * see {@see CONSUMER_DOMAINS}. The host is fixed, so the sender-controlled
     * domain only ever fills a query parameter — never the URL's host.
     *
     * @return array{body:string, mime:string}|null
     */
    private static function brandLogoFor(string $email): ?array
    {
        $domain = Str::after(mb_strtolower(trim($email)), '@');

        if ($domain === '' || ! str_contains($domain, '.') || in_array($domain, self::CONSUMER_DOMAINS, true)) {
            return null;
        }

        try {
            $response = Http::timeout(8)->get('https://www.google.com/s2/favicons', [
                'domain' => $domain,
                'sz' => 128,
            ]);
        } catch (Throwable) {
            return null;
        }

        // 404 is the service's "no logo for this domain" — a clean miss.
        $mime = trim(explode(';', strtolower((string) $response->header('Content-Type')))[0]);

        if (! $response->successful() || $response->body() === '' || ! str_starts_with($mime, 'image/')) {
            return null;
        }

        return ['body' => $response->body(), 'mime' => $mime];
    }

    /** @return array{body:string, mime:string}|null */
    public function read(): ?array
    {
        if (! $this->path || ! $this->disk) {
            return null;
        }

        try {
            if (! Storage::disk($this->disk)->exists($this->path)) {
                return null;
            }

            return [
                'body' => Storage::disk($this->disk)->get($this->path),
                'mime' => $this->mime ?: 'image/jpeg',
            ];
        } catch (Throwable) {
            return null;
        }
    }

    /** Senders worth asking about: same organisation as the mailbox itself. */
    public static function sameOrgAs(ConnectedAccount $account, string $email): bool
    {
        $domain = Str::after(mb_strtolower((string) $account->email), '@');
        $senderDomain = Str::after(mb_strtolower($email), '@');

        return $domain !== '' && $domain === $senderDomain;
    }
}
