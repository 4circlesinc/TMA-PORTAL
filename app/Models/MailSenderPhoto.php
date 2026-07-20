<?php

namespace App\Models;

use App\Jobs\ResolveSenderPhoto;
use App\Support\Mail\Mailbox;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * A cached profile photo for someone who sends you mail.
 *
 * Photos come from the mail provider's directory, so in practice this covers
 * colleagues in your own organisation. Everyone else is cached as a miss and
 * drawn as initials — no invented pictures.
 */
#[Fillable(['hash', 'email', 'connected_account_id', 'disk', 'path', 'mime', 'has_photo', 'checked_at'])]
class MailSenderPhoto extends Model
{
    /** How long before we ask the provider about a sender again. */
    private const HIT_TTL_DAYS = 30;

    private const MISS_TTL_DAYS = 7;

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

        $ttl = $this->has_photo ? self::HIT_TTL_DAYS : self::MISS_TTL_DAYS;

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
            return $row->has_photo ? $row->read() : null;
        }

        $bytes = null;
        try {
            $bytes = Mailbox::provider($account)->photoFor($email);
        } catch (Throwable) {
            // A provider error is a miss for now; the TTL brings us back.
        }

        $row ??= new self(['hash' => $hash, 'email' => mb_strtolower(trim($email))]);
        $row->connected_account_id = $account->id;
        $row->checked_at = now();

        if ($bytes === null || $bytes === '') {
            $row->has_photo = false;
            $row->save();

            return null;
        }

        $disk = config('filesystems.avatar_disk', config('filesystems.default'));
        $path = 'mail-sender-photos/'.$hash.'.jpg';
        Storage::disk($disk)->put($path, $bytes);

        $row->forceFill([
            'disk' => $disk,
            'path' => $path,
            'mime' => 'image/jpeg',
            'has_photo' => true,
        ])->save();

        return ['body' => $bytes, 'mime' => 'image/jpeg'];
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
