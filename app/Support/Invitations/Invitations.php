<?php

namespace App\Support\Invitations;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\Company;
use App\Models\EmailDelivery;
use App\Models\FileLibrarySetting;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\Pages;
use App\Support\Clients\ClientHubSettings;
use App\Support\Companies\CompanyMembers;
use App\Support\Files\FolderProvisioner;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Messaging\ClientConversations;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Everything an invitation does between being created and being accepted.
 *
 * Controllers here are thin on purpose: issuing, sending, accepting and
 * cancelling all have to keep the invitation row, the user account, the client
 * or company link, the audit trail and the notifications in step, and doing
 * that in one place is what stops the four drifting apart.
 *
 * ## Why a resend changes the link
 *
 * Only the SHA-256 of a token is stored, so the plaintext cannot be recovered
 * after it has been emailed. Every send therefore mints a fresh token and the
 * previous link stops working. That is the deliberate trade for not holding
 * live credentials in the database, and it means "Copy link" also rotates,
 * because handing out a link is handing out the credential.
 */
final class Invitations
{
    /** How long a new invitation stays valid, in days. */
    public const EXPIRY_DAYS = 7;

    /**
     * How long an invitation of this kind stays valid.
     *
     * Client-facing links honour the firm's Client hub access setting; a staff
     * invitation is not the client hub's business and keeps the constant.
     */
    private static function expiryDaysFor(string $type): int
    {
        return in_array($type, [Invitation::TYPE_CLIENT, Invitation::TYPE_COMPANY_MEMBER], true)
            ? ClientHubSettings::inviteExpiryDays()
            : self::EXPIRY_DAYS;
    }

    /**
     * Create an invitation, or refresh the live one that already exists for
     * this address and target. Returns the row and the plaintext token, the
     * token is not stored and is never returned again.
     *
     * @param  array<string,mixed>  $attrs
     * @return array{0: Invitation, 1: string}
     */
    public static function issue(array $attrs): array
    {
        $email = Str::lower(trim($attrs['email']));

        // One live invitation per address per target. A second ask is the same
        // invitation being chased, not a new one, otherwise the management
        // screen fills with duplicates of the same request.
        $invitation = Invitation::query()
            ->where('email', $email)
            ->where('type', $attrs['type'])
            ->where('client_id', $attrs['client_id'] ?? null)
            ->where('company_id', $attrs['company_id'] ?? null)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->first() ?? new Invitation;

        $invitation->fill([
            'type' => $attrs['type'],
            'email' => $email,
            'name' => $attrs['name'] ?? null,
            'client_id' => $attrs['client_id'] ?? null,
            'company_id' => $attrs['company_id'] ?? null,
            'role' => $attrs['role'] ?? Role::CLIENT,
            'access' => $attrs['access'] ?? null,
            'invited_by' => $attrs['invited_by'] ?? null,
            'expires_at' => now()->addDays($attrs['expiryDays'] ?? self::expiryDaysFor($attrs['type'])),
            'status' => Invitation::STATUS_PENDING,
            'last_error' => null,
        ]);

        $token = $invitation->issueToken();
        $invitation->save();

        return [$invitation, $token];
    }

    /**
     * Email an invitation. Rotates the token, so the link in this message is
     * the only one that works from now on.
     *
     * Sent inline rather than queued. Invitations are low-volume and the whole
     * point of one is that it arrives; this portal's queue has sat undrained
     * for days at a time, and an invitation stuck behind a stalled worker is
     * indistinguishable from a broken portal to the person waiting for it.
     * Sending inline costs a second on the request and, in exchange, the
     * outcome is known before the staff member sees the response.
     *
     * @param  bool  $reminder  a chase-up rather than a first ask
     */
    public static function send(Invitation $invitation, bool $reminder = false): ?EmailDelivery
    {
        $token = $invitation->issueToken();

        // Reset to pending *before* the send, for two reasons: a retry after a
        // failure must not stay stuck on `failed` when this attempt works, and
        // an inline send fires MessageSent during the call below, so the row
        // has to already say `pending` for the tracker to promote it.
        $invitation->forceFill([
            'status' => Invitation::STATUS_PENDING,
            'last_error' => null,
        ])->save();

        $delivery = null;

        try {
            $delivery = Deliveries::send(
                self::buildEmail($invitation, $token, $reminder),
                $invitation->email,
                $invitation,
                self::templateName($invitation, $reminder),
                immediate: true,
            );

            // Success is deliberately *not* written here. Handing a mailable
            // over is not delivery, "sent" has to mean a transport accepted
            // it, so MailTrackingServiceProvider sets that from MessageSent.
            // Only the counters are ours to record.
            //
            // The invitation stays live whatever the transport did: it is the
            // send that failed, not the invitation, and staff can retry it or
            // copy the link out of the management screen.
            $invitation->forceFill(array_merge(
                ['send_count' => $invitation->send_count + 1],
                $delivery?->hasFailed()
                    ? ['status' => Invitation::STATUS_FAILED, 'last_error' => $delivery->error]
                    : ['last_sent_at' => now()],
            ))->save();
        } catch (\Throwable $e) {
            // Nowhere to record it, no delivery row was written at all.
            $invitation->forceFill([
                'status' => Invitation::STATUS_FAILED,
                'last_error' => mb_substr($e->getMessage(), 0, 2000),
            ])->save();
        }

        return $delivery;
    }

    /** The postcard for an invitation, in the right words for its type. */
    private static function buildEmail(Invitation $invitation, string $token, bool $reminder): Postcard
    {
        $url = $invitation->acceptUrl($token);
        $inviter = $invitation->inviter?->name;
        $expires = $invitation->expires_at;
        $hasAccount = $invitation->existingUser() !== null;

        if ($reminder && $invitation->type === Invitation::TYPE_CLIENT) {
            return Postcards::clientInviteReminder($invitation->name, $url, $expires);
        }

        return match ($invitation->type) {
            Invitation::TYPE_STAFF => Postcards::staffInvite(
                $invitation->name,
                $url,
                $invitation->role,
                $inviter,
                $expires,
                $invitation->access['department'] ?? null,
                $hasAccount,
            ),
            Invitation::TYPE_COMPANY_MEMBER => Postcards::companyMemberInvite(
                $invitation->name,
                $invitation->company?->name ?? 'your company',
                $url,
                $invitation->access['companyRole'] ?? 'Member',
                $inviter,
                $expires,
                $hasAccount,
            ),
            default => Postcards::clientInvite($invitation->name, $url, $inviter, $expires, $hasAccount),
        };
    }

    private static function templateName(Invitation $invitation, bool $reminder): string
    {
        if ($reminder && $invitation->type === Invitation::TYPE_CLIENT) {
            return 'clientInviteReminder';
        }

        return match ($invitation->type) {
            Invitation::TYPE_STAFF => 'staffInvite',
            Invitation::TYPE_COMPANY_MEMBER => 'companyMemberInvite',
            default => 'clientInvite',
        };
    }

    /**
     * Split a stored full name into first / middle / last for the invite form.
     *
     * @return array{first: string, middle: string, last: string}
     */
    public static function splitName(?string $name): array
    {
        $parts = preg_split('/\s+/', trim((string) $name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $first = (string) (array_shift($parts) ?: '');
        $last = $parts ? (string) array_pop($parts) : '';
        $middle = $parts ? implode(' ', $parts) : '';

        return ['first' => $first, 'middle' => $middle, 'last' => $last];
    }

    /**
     * Accept an invitation for a brand-new account.
     *
     * Refuses when the address already has a login, that path has to go
     * through {@see self::acceptAs()} after signing in, so an invitation can
     * never mint a second account for someone who already has one.
     *
     * @param  array{first_name?: ?string, middle_name?: ?string, last_name?: ?string}  $name
     */
    public static function acceptAsNewUser(Invitation $invitation, string $password, array $name = []): User
    {
        abort_unless($invitation->isAcceptable(), 410, 'This invitation is no longer valid.');
        abort_if($invitation->existingUser() !== null, 409, 'An account already exists for this email address.');

        $fallback = self::splitName($invitation->name ?: $invitation->client?->name);
        $first = trim((string) ($name['first_name'] ?? '')) ?: $fallback['first'];
        $middle = trim((string) ($name['middle_name'] ?? '')) ?: $fallback['middle'];
        $last = trim((string) ($name['last_name'] ?? '')) ?: $fallback['last'];

        if ($first === '') {
            $first = Str::before($invitation->email, '@');
        }

        return DB::transaction(function () use ($invitation, $password, $first, $middle, $last) {
            $user = new User([
                'first_name' => $first,
                'middle_name' => $middle !== '' ? $middle : null,
                'last_name' => $last !== '' ? $last : null,
                'email' => $invitation->email,
                'password' => $password,
            ]);
            $user->syncDisplayName();

            // Invited by someone who works here: the address is vouched for and
            // the account is pre-approved, so they land in onboarding rather
            // than on the pending-approval screen.
            $user->forceFill([
                'email_verified_at' => now(),
                'status' => 'approved',
                'account_type' => $invitation->role ?: Role::CLIENT,
                'approved_at' => now(),
                'approved_by' => $invitation->invited_by,
            ])->save();

            self::link($invitation, $user);

            return $user;
        });
    }

    /**
     * Accept an invitation for an account that already exists. Adds the access
     * to the account it is signed in as, it never creates anything new.
     */
    public static function acceptAs(Invitation $invitation, User $user): User
    {
        abort_unless($invitation->isAcceptable(), 410, 'This invitation is no longer valid.');

        return DB::transaction(function () use ($invitation, $user) {
            self::link($invitation, $user);

            return $user->fresh();
        });
    }

    /**
     * Attach whatever the invitation offers to the account, mark it accepted,
     * and tell the people who need to know.
     */
    private static function link(Invitation $invitation, User $user): void
    {
        if ($invitation->type === Invitation::TYPE_STAFF) {
            // A staff invitation can promote an existing client account, but it
            // must never quietly demote an administrator.
            if (! Role::isAdmin($user)) {
                $user->forceFill(['account_type' => $invitation->role ?: Role::REVIEWING_OFFICER])->save();
            }

            if (! empty($invitation->access['jobTitle']) && ! $user->job_title) {
                $user->forceFill(['job_title' => $invitation->access['jobTitle']])->save();
            }

            // The staff folder used to be created when the invitation was sent,
            // back when that also created the account. There is no account to
            // hang it on until now.
            if (Role::isStaff($user->fresh()) && FileLibrarySetting::autoCreateStaffFolder()) {
                FolderProvisioner::provisionStaffFolder($user->fresh(), $invitation->inviter ?? $user);
            }
        }

        // A company-member invitation also activates their membership, which is
        // what turns the company's `can_*` flags on for this account.
        if ($invitation->type === Invitation::TYPE_COMPANY_MEMBER) {
            CompanyMembers::linkAcceptedUser($invitation, $user);
        }

        // Client and company-member invitations both hang off a client record —
        // a company member is the company's contact person.
        if ($invitation->client_id && $invitation->client) {
            $client = $invitation->client;

            // Never steal a client record that is already someone else's.
            if ($client->user_id === null) {
                $client->forceFill(['user_id' => $user->id])->save();
            }

            if ($invitation->company_id && $client->company_id === null) {
                $client->forceFill(['company_id' => $invitation->company_id])->save();
            }
        }

        ClientConversations::attachLogin($user);

        $invitation->forceFill([
            'status' => Invitation::STATUS_ACCEPTED,
            'accepted_at' => now(),
            'accepted_user_id' => $user->id,
        ])->save();

        self::announceAcceptance($invitation, $user);
    }

    /** Audit the acceptance and tell the inviter and any assigned staff. */
    private static function announceAcceptance(Invitation $invitation, User $user): void
    {
        $client = $invitation->client;
        $what = $client?->name ?? $invitation->company?->name ?? 'the portal';

        ActivityLogger::log([
            'actor' => $user,
            'type' => 'client.invitation',
            'description' => $user->name.' accepted their invitation to '.$what,
            'subject' => $invitation,
            'client' => $client,
            'metadata' => ['invitationType' => $invitation->type, 'invitationId' => $invitation->uuid],
        ]);

        // Everyone who should hear about it: whoever sent the invitation, plus
        // the staff already assigned to this client. Deduplicated so the
        // inviter who is also the assigned manager is told once.
        $recipients = collect([$invitation->inviter])
            ->merge($client?->assignments()->with('user')->get()->pluck('user') ?? [])
            ->filter()
            ->unique('id')
            ->reject(fn (User $u) => $u->id === $user->id);

        foreach ($recipients as $recipient) {
            Notifier::send([
                'user' => $recipient,
                'actor' => $user,
                'type' => 'client.invitation',
                'title' => $user->name.' accepted their invitation',
                'message' => 'They now have access to '.$what.'.',
                'subject' => $invitation,
                'client' => $client,
                'action_url' => $client ? Pages::application($client->uid) : '/users',
            ]);
        }
    }

    /** Withdraw an invitation. The link stops working immediately. */
    public static function cancel(Invitation $invitation, ?User $by = null): Invitation
    {
        $invitation->forceFill([
            'status' => Invitation::STATUS_CANCELLED,
            'cancelled_at' => now(),
            'cancelled_by' => $by?->id,
        ])->save();

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'client.invitation',
            'description' => ($by?->name ?? 'Someone').' cancelled the invitation to '.$invitation->email,
            'subject' => $invitation,
            'client' => $invitation->client,
            'metadata' => ['invitationId' => $invitation->uuid, 'action' => 'cancelled'],
        ]);

        return $invitation;
    }

    /** The record shape the invitation management screen consumes. */
    public static function toRecord(Invitation $invitation): array
    {
        $invitation->syncExpiry();
        $latest = $invitation->deliveries()->first();

        return [
            'id' => $invitation->uuid,
            'type' => $invitation->type,
            'typeLabel' => match ($invitation->type) {
                Invitation::TYPE_STAFF => 'Staff',
                Invitation::TYPE_COMPANY_MEMBER => 'Company member',
                default => 'Client',
            },
            'email' => $invitation->email,
            'name' => $invitation->name,
            'role' => $invitation->role,
            'offer' => $invitation->offerLabel(),
            'status' => $invitation->status,
            'client' => $invitation->client ? [
                'id' => $invitation->client->uid,
                'name' => $invitation->client->name,
            ] : null,
            'company' => $invitation->company ? [
                'id' => $invitation->company->uid,
                'name' => $invitation->company->name,
            ] : null,
            'invitedBy' => $invitation->inviter?->name,
            'sentAt' => $invitation->last_sent_at?->toIso8601String(),
            'expiresAt' => $invitation->expires_at?->toIso8601String(),
            'acceptedAt' => $invitation->accepted_at?->toIso8601String(),
            'cancelledAt' => $invitation->cancelled_at?->toIso8601String(),
            'sendCount' => $invitation->send_count,
            'lastError' => $invitation->last_error,
            'delivery' => $latest?->toRecord(),
            'canResend' => $invitation->isAcceptable() || $invitation->status === Invitation::STATUS_EXPIRED,
            'canCancel' => $invitation->isAcceptable(),
        ];
    }

    /** A display name for whatever the invitation is attached to. */
    public static function targetLabel(Invitation $invitation): string
    {
        return $invitation->client?->name
            ?? $invitation->company?->name
            ?? Company::find($invitation->company_id)?->name
            ?? Client::find($invitation->client_id)?->name
            ?? 'the portal';
    }

    /**
     * One sentence for the invite screen. The logo already names the firm, so
     * this only says who invited them and where, never both of those twice.
     */
    public static function screenLead(Invitation $invitation, ?string $inviter, string $organisation): string
    {
        $place = match ($invitation->type) {
            Invitation::TYPE_COMPANY_MEMBER => $invitation->company?->name
                ?? Company::find($invitation->company_id)?->name,
            Invitation::TYPE_CLIENT => $invitation->client?->name
                ?? Client::find($invitation->client_id)?->name,
            default => null,
        };
        if ($place && ($place === 'the portal' || self::sameName($place, $organisation))) {
            $place = null;
        }
        $person = ($inviter && ! self::sameName($inviter, $organisation))
            ? $inviter
            : null;

        if ($person && $place) {
            return $person.' invited you to '.$place.'.';
        }
        if ($person) {
            return $person.' invited you.';
        }
        if ($place) {
            return 'You have been invited to '.$place.'.';
        }

        return match ($invitation->type) {
            Invitation::TYPE_STAFF => 'You have been invited to join the team.',
            Invitation::TYPE_COMPANY_MEMBER => 'You have been invited to a company account.',
            default => 'You have been invited to the client portal.',
        };
    }

    private static function sameName(string $a, string $b): bool
    {
        return strcasecmp(trim($a), trim($b)) === 0;
    }
}
