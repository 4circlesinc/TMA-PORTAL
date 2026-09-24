<?php

namespace App\Support\Privacy;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\Notification;
use App\Models\PrivacyRequest;
use App\Models\TrustedDevice;
use App\Models\User;
use App\Models\UserLocation;
use App\Models\UserPresence;
use App\Models\UserPresenceState;
use App\Support\Access\Role;
use App\Support\AvatarService;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Close a login and erase the personal data that is not part of a matter.
 *
 * Files, messages, signatures, citizenship records, and the audit of actions
 * on those matters stay. Professional record-keeping and the work the client
 * asked for are reasons the regulation itself allows the firm to keep them.
 * What stays is written on the privacy request so it can be shown later.
 */
final class AccountErasure
{
    /**
     * @return array{erased: true, kept: list<array{category: string, reason: string}>}
     */
    public static function run(User $user): array
    {
        if (self::isLastAdministrator($user)) {
            PrivacyRequest::query()->create([
                'user_id' => $user->id,
                'type' => PrivacyRequest::TYPE_ERASURE,
                'status' => PrivacyRequest::STATUS_REFUSED,
                'detail' => [
                    'reason' => 'Refused because this is the only administrator account.',
                ],
            ]);

            throw ValidationException::withMessages([
                'account' => 'You are the only administrator. Appoint another administrator before erasing this account.',
            ]);
        }

        $name = (string) $user->name;
        $email = (string) $user->email;
        $first = $user->first_name ?: null;
        $kept = self::kept();

        DB::transaction(function () use ($user, $name, $email, $kept) {
            self::deletePersonalRows($user, $email);
            self::scrubTrail($user, $name, $email);
            self::anonymize($user);

            PrivacyRequest::query()->create([
                'user_id' => $user->id,
                'type' => PrivacyRequest::TYPE_ERASURE,
                'status' => PrivacyRequest::STATUS_COMPLETED,
                'detail' => [
                    'name' => $name,
                    'email' => $email,
                    'policyVersion' => PrivacyPolicy::VERSION,
                    'kept' => $kept,
                ],
            ]);
        });

        // After the account is closed, so a failed erase never sends a
        // confirmation for something that did not happen.
        Deliveries::send(
            Postcards::accountErased($email, $first),
            $email,
            $user,
            'accountErased',
            immediate: true,
        );

        Notifier::notifyAdmins([
            'actor' => $user,
            'type' => 'account.erased',
            'title' => 'Account erased on request',
            'message' => $name.' ('.$email.') erased their portal login. Matter files and citizenship records were kept.',
        ]);

        return ['erased' => true, 'kept' => $kept];
    }

    /**
     * Signing out writes one more sign-in row and one more audit line.
     * Drop the sign-in row and strip location off the audit line. The line
     * itself stays, under the anonymized name.
     */
    public static function forgetSignOutTrail(int $userId): void
    {
        AuthEvent::query()->where('user_id', $userId)->delete();

        ActivityLog::query()
            ->where('actor_id', $userId)
            ->where('activity_type', 'security.logout')
            ->update([
                'ip_address' => null,
                'user_agent' => null,
                'country' => null,
                'city' => null,
                'region' => null,
                'postal' => null,
                'latitude' => null,
                'longitude' => null,
            ]);
    }

    private static function isLastAdministrator(User $user): bool
    {
        if (! Role::isAdmin($user)) {
            return false;
        }

        return ! User::query()
            ->where('account_type', Role::ADMINISTRATOR)
            ->where('status', User::STATUS_APPROVED)
            ->where('id', '!=', $user->id)
            ->exists();
    }

    /**
     * @return list<array{category: string, reason: string}>
     */
    private static function kept(): array
    {
        return [
            [
                'category' => 'Matter files, messages, signatures, and citizenship records',
                'reason' => 'Kept to perform the work and to meet professional and legal record-keeping duties.',
            ],
            [
                'category' => 'Audit of actions on a matter',
                'reason' => 'Kept so the firm can show who did what on a file. Your name and email are removed from those entries, and location data on them is deleted.',
            ],
            [
                'category' => 'This erasure request',
                'reason' => 'Kept, including the email address it concerned, so the firm can show what was deleted and what was kept.',
            ],
        ];
    }

    private static function deletePersonalRows(User $user, string $email): void
    {
        DB::table('sessions')->where('user_id', $user->id)->delete();
        DB::table('password_reset_tokens')->where('email', $email)->delete();

        TrustedDevice::query()->where('user_id', $user->id)->delete();
        DB::table('device_tokens')->where('user_id', $user->id)->delete();
        ConnectedAccount::query()->where('user_id', $user->id)->delete();
        Notification::query()->where('user_id', $user->id)->delete();
        AuthEvent::query()->where('user_id', $user->id)->delete();
        UserLocation::query()->where('user_id', $user->id)->delete();
        UserPresence::query()->where('user_id', $user->id)->delete();
        UserPresenceState::query()->where('user_id', $user->id)->delete();
    }

    private static function scrubTrail(User $user, string $name, string $email): void
    {
        $likeEmail = '%'.addcslashes($email, '%_\\').'%';

        ActivityLog::query()
            ->where(function ($query) use ($user, $likeEmail) {
                $query->where('actor_id', $user->id)
                    ->orWhere('description', 'like', $likeEmail);
            })
            ->orderBy('id')
            ->each(function (ActivityLog $log) use ($name, $email) {
                $description = str_replace([$email, $name], 'Deleted user', (string) $log->description);
                $log->forceFill([
                    'description' => $description,
                    'ip_address' => null,
                    'user_agent' => null,
                    'country' => null,
                    'city' => null,
                    'region' => null,
                    'postal' => null,
                    'latitude' => null,
                    'longitude' => null,
                ])->save();
            });
    }

    private static function anonymize(User $user): void
    {
        AvatarService::deletePrevious($user->avatar_url);

        $user->forceFill([
            'name' => 'Deleted user',
            'first_name' => 'Deleted',
            'middle_name' => null,
            'last_name' => 'user',
            'email' => 'erased-'.$user->id.'@users.invalid',
            'phone' => null,
            'phone_verified_at' => null,
            'job_title' => null,
            'company' => null,
            'gender' => null,
            'bio' => null,
            'linkedin_url' => null,
            'avatar_url' => null,
            'provider_avatar_url' => null,
            'preferences' => [],
            'password' => Str::random(40),
            'remember_token' => null,
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'password_auto' => false,
            'processing_restricted_at' => null,
            'deleted_by' => $user->id,
        ])->save();

        $user->delete();
    }
}
