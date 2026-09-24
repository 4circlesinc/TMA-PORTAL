<?php

namespace App\Models;

use App\Listeners\RecordAuthEvent;
use App\Notifications\PortalResetPassword;
use App\Notifications\PortalVerifyEmail;
use App\Support\Access\Role;
use App\Support\Messaging\MessagingSettings;
use App\Support\SecurityPolicies;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Fortify\TwoFactorAuthenticatable;

#[Fillable(['name', 'first_name', 'middle_name', 'last_name', 'gender', 'email', 'password', 'status', 'account_type', 'phone', 'job_title', 'company', 'bio', 'linkedin_url'])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])]
class User extends Authenticatable implements MustVerifyEmail
{
    /**
     * SoftDeletes is what puts a removed account in the admin Recycle Bin. It
     * also does the security work for free: the global scope hides trashed rows
     * from every query in the portal, including the one Laravel's auth guard
     * uses to resolve credentials, so a deleted account cannot sign back in.
     *
     * @use HasFactory<UserFactory>
     */
    use HasFactory, Notifiable, SoftDeletes, TwoFactorAuthenticatable;

    public const string STATUS_PENDING = 'pending';

    public const string STATUS_APPROVED = 'approved';

    public const string STATUS_SUSPENDED = 'suspended';

    /**
     * A new account starts pending, in memory as well as in the table.
     *
     * The column already defaults to 'pending', but a database default only
     * fills the row — it never travels back to the instance that was just
     * saved. So `User::create([...])` without an explicit status handed every
     * listener a model whose `status` was NULL, and
     * {@see RecordAuthEvent::handleRegistered} compares it to
     * STATUS_PENDING: registrations silently skipped the administrator alert,
     * the audit entry and the "we've received your request" email, while the
     * stored row looked perfectly correct.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => self::STATUS_PENDING,
        'require_two_factor' => false,
    ];

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $this->notify(new PortalResetPassword($token));
    }

    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new PortalVerifyEmail);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'profile_completed_at' => 'datetime',
            'onboarding_completed_at' => 'datetime',
            'approved_at' => 'datetime',
            'phone_verified_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
            'last_authenticated_at' => 'datetime',
            'password' => 'hashed',
            'preferences' => 'array',
            'require_two_factor' => 'boolean',
            'privacy_policy_accepted_at' => 'datetime',
            'processing_restricted_at' => 'datetime',
        ];
    }

    /**
     * Build the display name from its parts. `name` stays the single source
     * for everything that shows a user (sidebar, tables, emails).
     */
    public function syncDisplayName(): void
    {
        $full = trim(implode(' ', array_filter([
            $this->first_name,
            $this->middle_name,
            $this->last_name,
        ])));

        if ($full !== '') {
            $this->name = $full;
        }
    }

    public function isApproved(): bool
    {
        return $this->status === self::STATUS_APPROVED;
    }

    public function hasTwoFactorEnabled(): bool
    {
        return $this->two_factor_confirmed_at !== null;
    }

    /**
     * Must this account use an authenticator app? Either Sign-in policy for
     * this account type, or an administrator requiring it on this person.
     * Stricter wins: a person flag or a matching account-type policy both
     * block the portal until the authenticator app is confirmed.
     */
    public function mustUseAuthenticator(): bool
    {
        return $this->require_two_factor || SecurityPolicies::authenticatorRequired($this);
    }

    /**
     * The picture to show for this person: their uploaded portal avatar, or
     * the Microsoft/Google photo captured at sign-in when they never set one.
     */
    public function photoUrl(): ?string
    {
        return $this->avatar_url ?: $this->provider_avatar_url;
    }

    /**
     * Select one key of `preferences` as the whole `preferences` column.
     *
     * A listing that wants a single setting should not carry the blob it
     * lives in. The column holds whatever the person has ever configured,
     * and a pasted email signature makes that megabytes: one row on this
     * firm is 5.4 MB against a kilobyte for everybody else, and a board
     * that reads every account paid to decode it on every poll.
     *
     * The value still arrives shaped like `preferences`, so
     * {@see MessagingSettings::for()} and anything
     * else reading that key works unchanged — it simply cannot see the keys
     * that were not asked for. Do not use this on a query whose rows are
     * going to be saved: what is loaded is what would be written back.
     */
    public function scopeSelectJsonPreference(Builder $query, string $key): Builder
    {
        $driver = $query->getConnection()->getDriverName();

        // The key is cast on the way in: Postgres will not infer the type of
        // a bare placeholder standing where a function argument goes.
        $sql = match ($driver) {
            'pgsql' => 'json_build_object(?::text, (preferences::jsonb -> ?::text)) as preferences',
            'mysql', 'mariadb' => "json_object(?, json_extract(preferences, concat('$.', ?))) as preferences",
            // SQLite, and anything else, where json_object/json_extract exist
            // but concat does not: '$.' || ? is the portable spelling.
            default => "json_object(?, json_extract(preferences, '$.' || ?)) as preferences",
        };

        return $query->selectRaw($sql, [$key, $key]);
    }

    /**
     * Who this person is at the firm, for a card that names them.
     *
     * Job title when they have one, otherwise the account type they hold.
     * Not the CIP assignment job: that defaults to reviewing officer for
     * whoever is handed a file, so an administrator would otherwise read
     * as "Reviewing officer" on every hover.
     */
    public function roleName(): string
    {
        $title = trim((string) $this->job_title);

        if ($title !== '') {
            return $title;
        }

        return (string) (Role::of($this) ?? $this->account_type ?? '');
    }

    /** The administrator who moved this account to the Recycle Bin. */
    public function deletedBy(): BelongsTo
    {
        return $this->belongsTo(self::class, 'deleted_by');
    }

    public function connectedAccounts(): HasMany
    {
        return $this->hasMany(ConnectedAccount::class);
    }

    public function trustedDevices(): HasMany
    {
        return $this->hasMany(TrustedDevice::class);
    }

    public function favorites(): HasMany
    {
        return $this->hasMany(Favorite::class);
    }

    /**
     * Online/last-seen state, as a relation so it can be eager loaded.
     *
     * PresenceService::forViewer used to fetch this per subject, which meant one
     * query per participant when presenting a conversation list — the single
     * biggest cost of loading the Messages page.
     */
    public function presence(): HasOne
    {
        return $this->hasOne(UserPresence::class);
    }

    public function connectedAccount(string $provider): ?ConnectedAccount
    {
        return $this->connectedAccounts->firstWhere('provider', $provider);
    }

    /** The client record this account signs in for, when it is a client. */
    public function clientRecord(): HasOne
    {
        return $this->hasOne(Client::class);
    }

    /**
     * Who this person works for, for the profile card.
     *
     * Staff type their own. A client account usually has one already: staff
     * recorded it on the client record when they were set up, and repeating
     * that typing would be the only way to see it here.
     */
    public function companyName(): ?string
    {
        return $this->company ?: $this->clientRecord?->company;
    }
}
