<?php

namespace App\Support\Privacy;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\FileItem;
use App\Models\User;

/**
 * A machine-readable copy of one person's account data (GDPR Arts. 15 and 20).
 *
 * Matter documents, citizenship files, and other people's messages are listed,
 * not dumped. Those records include someone else's data, and the person can
 * already open the copies the portal holds for their matter.
 */
final class PersonalDataExport
{
    /**
     * @return array<string, mixed>
     */
    public static function for(User $user): array
    {
        return [
            'exportedAt' => now()->toIso8601String(),
            'policyVersion' => PrivacyPolicy::VERSION,
            'controller' => [
                'name' => 'TM ANTOINE Advisory',
                'email' => 'support@tmantoinelaw.com',
                'address' => 'TaylorMarc Court, Rodney Bay, Gros Islet, Saint Lucia',
            ],
            'account' => [
                'id' => $user->id,
                'name' => $user->name,
                'firstName' => $user->first_name,
                'middleName' => $user->middle_name,
                'lastName' => $user->last_name,
                'email' => $user->email,
                'phone' => $user->phone,
                'jobTitle' => $user->job_title,
                'company' => $user->company,
                'gender' => $user->gender,
                'bio' => $user->bio,
                'linkedinUrl' => $user->linkedin_url,
                'accountType' => $user->account_type,
                'status' => $user->status,
                'createdAt' => optional($user->created_at)->toIso8601String(),
                'emailVerifiedAt' => optional($user->email_verified_at)->toIso8601String(),
                'privacyPolicyAcceptedAt' => optional($user->privacy_policy_accepted_at)->toIso8601String(),
                'privacyPolicyVersion' => $user->privacy_policy_version,
                'processingRestrictedAt' => optional($user->processing_restricted_at)->toIso8601String(),
            ],
            'preferences' => $user->preferences ?? [],
            'connectedAccounts' => self::connections($user),
            'signIns' => self::signIns($user),
            'activity' => self::activity($user),
            'filesYouUploaded' => self::files($user),
            'matters' => [
                'note' => 'Citizenship files, identity documents, shared messages, signatures, and call recordings are kept so the firm can do the work you asked for and meet its professional record-keeping duties. Open them in the portal, or email support@tmantoinelaw.com to ask for a specific copy. This download does not include other people\'s personal data from those files.',
            ],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function connections(User $user): array
    {
        return ConnectedAccount::query()
            ->where('user_id', $user->id)
            ->get()
            ->map(fn (ConnectedAccount $account) => [
                'provider' => $account->provider,
                'email' => $account->email,
                'name' => $account->name,
                'syncEmail' => (bool) $account->sync_email,
                'syncCalendar' => (bool) $account->sync_calendar,
                'syncOneDrive' => (bool) $account->sync_onedrive,
                'syncSharePoint' => (bool) $account->sync_sharepoint,
                'connectedAt' => optional($account->created_at)->toIso8601String(),
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function signIns(User $user): array
    {
        return AuthEvent::query()
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(500)
            ->get()
            ->map(fn (AuthEvent $event) => [
                'event' => $event->event,
                'at' => optional($event->created_at)->toIso8601String(),
                'ip' => $event->ip,
                'country' => $event->country,
                'city' => $event->city,
                'device' => $event->user_agent,
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function activity(User $user): array
    {
        return ActivityLog::query()
            ->where('actor_id', $user->id)
            ->latestFirst()
            ->limit(500)
            ->get()
            ->map(fn (ActivityLog $log) => [
                'type' => $log->activity_type,
                'description' => $log->description,
                'at' => optional($log->created_at)->toIso8601String(),
            ])
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function files(User $user): array
    {
        return FileItem::query()
            ->where('uploaded_by', $user->id)
            ->latest('id')
            ->limit(500)
            ->get()
            ->map(fn (FileItem $file) => [
                'name' => $file->name,
                'size' => $file->size,
                'uploadedAt' => optional($file->created_at)->toIso8601String(),
            ])
            ->all();
    }
}
