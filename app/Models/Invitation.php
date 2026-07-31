<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Str;

/**
 * An outstanding "join the portal" ask — for a client, a staff member, or a
 * person being added to a company account.
 *
 * The emailed token is never persisted. {@see self::issueToken()} returns the
 * plaintext exactly once, for the link, and stores only its digest; every
 * later lookup goes through {@see self::findByToken()}. The digest is unsalted
 * because it has to be searchable, which is safe here: the token is 48
 * characters of CSPRNG output, so there is nothing to brute-force offline.
 */
#[Fillable([
    'uuid', 'type', 'token_hash', 'email', 'name', 'client_id', 'company_id',
    'role', 'access', 'status', 'invited_by', 'accepted_user_id', 'expires_at',
    'last_sent_at', 'opened_at', 'accepted_at', 'cancelled_at', 'cancelled_by',
    'send_count', 'last_error',
])]
class Invitation extends Model
{
    public const TYPE_CLIENT = 'client';

    public const TYPE_STAFF = 'staff';

    public const TYPE_COMPANY_MEMBER = 'company_member';

    public const TYPES = [self::TYPE_CLIENT, self::TYPE_STAFF, self::TYPE_COMPANY_MEMBER];

    public const STATUS_PENDING = 'pending';

    public const STATUS_SENT = 'sent';

    public const STATUS_DELIVERED = 'delivered';

    public const STATUS_OPENED = 'opened';

    public const STATUS_ACCEPTED = 'accepted';

    public const STATUS_EXPIRED = 'expired';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUS_FAILED = 'failed';

    /**
     * Statuses an invitation can still be accepted from. Note that `failed`
     * qualifies: the send failed, not the invitation — if the recipient does
     * somehow reach the link (a copied one, a later retry), it must still work.
     */
    public const LIVE_STATUSES = [
        self::STATUS_PENDING, self::STATUS_SENT, self::STATUS_DELIVERED,
        self::STATUS_OPENED, self::STATUS_FAILED,
    ];

    protected function casts(): array
    {
        return [
            'access' => 'array',
            'expires_at' => 'datetime',
            'last_sent_at' => 'datetime',
            'opened_at' => 'datetime',
            'accepted_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Invitation $invitation) {
            $invitation->uuid ??= (string) Str::uuid();
        });
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }

    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    public function acceptedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_user_id');
    }

    /** Every send attempt for this invitation, newest first. */
    public function deliveries(): MorphMany
    {
        return $this->morphMany(EmailDelivery::class, 'related')->latest('id');
    }

    /**
     * Mint a new token, store its digest, and hand the plaintext back. The
     * return value is the only copy — it goes straight into the link and is
     * never written anywhere.
     */
    public function issueToken(): string
    {
        $token = Str::random(48);
        $this->token_hash = self::hash($token);

        return $token;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function findByToken(string $token): ?self
    {
        return static::where('token_hash', self::hash($token))->first();
    }

    /** Past its expiry date, whatever the stored status says. */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /** Can this invitation still be accepted right now? */
    public function isAcceptable(): bool
    {
        return in_array($this->status, self::LIVE_STATUSES, true)
            && $this->accepted_at === null
            && $this->cancelled_at === null
            && ! $this->isExpired();
    }

    /**
     * Why the invitation cannot be accepted — the key the public screen turns
     * into a message. Null when it is fine.
     */
    public function blockedReason(): ?string
    {
        if ($this->accepted_at !== null || $this->status === self::STATUS_ACCEPTED) {
            return 'accepted';
        }

        if ($this->cancelled_at !== null || $this->status === self::STATUS_CANCELLED) {
            return 'cancelled';
        }

        if ($this->isExpired()) {
            return 'expired';
        }

        return null;
    }

    /**
     * Flip a stored `pending`/`sent` row to `expired` once its date has passed,
     * so the management screen reports the truth without a scheduled job.
     */
    public function syncExpiry(): self
    {
        if ($this->isExpired()
            && in_array($this->status, [self::STATUS_PENDING, self::STATUS_SENT, self::STATUS_DELIVERED, self::STATUS_OPENED], true)
        ) {
            $this->forceFill(['status' => self::STATUS_EXPIRED])->save();
        }

        return $this;
    }

    /** The portal account this address already belongs to, if any. */
    public function existingUser(): ?User
    {
        return User::where('email', $this->email)->first();
    }

    public function acceptUrl(string $token): string
    {
        return url('/invite/'.$token);
    }

    /** What the invitation is offering, in words, for the email and the screen. */
    public function offerLabel(): string
    {
        return match ($this->type) {
            self::TYPE_STAFF => $this->role === 'Administrator' ? 'Administrator access' : 'Staff access',
            self::TYPE_COMPANY_MEMBER => $this->company?->name
                ? 'Access to '.$this->company->name
                : 'Company access',
            default => 'Client portal access',
        };
    }
}
