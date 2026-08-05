<?php

namespace App\Models;

use App\Notifications\QueuedResetPassword;
use App\Notifications\QueuedVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
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

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $this->notify(new QueuedResetPassword($token));
    }

    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new QueuedVerifyEmail);
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
            'password' => 'hashed',
            'preferences' => 'array',
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
     * The picture to show for this person: their uploaded portal avatar, or
     * the Microsoft/Google photo captured at sign-in when they never set one.
     */
    public function photoUrl(): ?string
    {
        return $this->avatar_url ?: $this->provider_avatar_url;
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
