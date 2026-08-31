<?php

namespace App\Support\Cip;

use App\Events\CipThreadChanged;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipApplicationMessageRead;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\ContactIdentity;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use App\Support\Realtime\Live;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The application messaging centre (§24).
 *
 * One thread per file, two lanes on the row. Internal notes are filtered
 * out of every read the provider side makes. Provider messages replace the
 * email side-channel: one postcard per other-side mailbox, a bell for portal
 * accounts, and a realtime signal that never carries the body.
 */
class Threads
{
    public const MAX_LENGTH = 4000;

    public const PROVIDER_LABEL = 'Service provider';

    public static function canPostInternal(?User $user): bool
    {
        return $user !== null && Role::isStaff($user);
    }

    /**
     * @return list<string>
     */
    public static function lanesFor(?User $user): array
    {
        return self::canPostInternal($user)
            ? [CipApplicationMessage::LANE_INTERNAL, CipApplicationMessage::LANE_PROVIDER]
            : [CipApplicationMessage::LANE_PROVIDER];
    }

    public static function create(CipApplication $application, User $author, string $body, string $lane): CipApplicationMessage
    {
        $body = trim($body);
        $lane = self::normaliseLane($lane, $author);

        if ($body === '') {
            throw ValidationException::withMessages([
                'body' => 'A message can’t be empty.',
            ]);
        }

        if ($lane === CipApplicationMessage::LANE_INTERNAL && ! self::canPostInternal($author)) {
            throw ValidationException::withMessages([
                'lane' => 'Internal notes are staff only.',
            ]);
        }

        $application->loadMissing('provider');
        $stamp = ContactIdentity::stamp($author, $application->provider?->company_id);

        $message = CipApplicationMessage::create([
            'application_id' => $application->id,
            'author_id' => $author->id,
            'company_member_id' => $stamp['company_member_id'],
            'author_name' => $stamp['actor_name'] ?: $author->name,
            'lane' => $lane,
            'body' => $body,
        ]);

        self::markRead($application, $author, $message->id);
        self::announce($application, $message, $author);
        CipThreadChanged::dispatch($application, 'created');
        Live::staff(Live::CIP);
        Live::users(Live::CIP, self::recipientUserIds($application, $message, $author));

        return $message;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listed(CipApplication $application, User $viewer): array
    {
        $lanes = self::lanesFor($viewer);

        return CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->whereIn('lane', $lanes)
            ->with(['author', 'companyMember'])
            ->orderBy('id')
            ->get()
            ->map(fn (CipApplicationMessage $message) => self::present($message, $viewer))
            ->all();
    }

    public static function markRead(CipApplication $application, User $viewer, ?int $through = null): void
    {
        $through ??= (int) CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->whereIn('lane', self::lanesFor($viewer))
            ->max('id');

        if ($through < 1) {
            return;
        }

        $row = CipApplicationMessageRead::query()->firstOrNew([
            'user_id' => $viewer->id,
            'application_id' => $application->id,
        ]);

        if ((int) $row->last_read_id >= $through) {
            return;
        }

        $row->forceFill(['last_read_id' => $through])->save();
    }

    /**
     * Unread application-thread messages, keyed by client id, for the table
     * envelope. Internal notes never count for an account that cannot see them.
     *
     * @param  list<int>  $clientIds
     * @return array<int, int>
     */
    public static function unreadByClient(User $viewer, array $clientIds): array
    {
        $clientIds = array_values(array_unique(array_filter($clientIds)));

        if ($clientIds === []) {
            return [];
        }

        $lanes = self::lanesFor($viewer);

        $rows = CipApplicationMessage::query()
            ->join('cip_applications', 'cip_applications.id', '=', 'cip_application_messages.application_id')
            ->leftJoin('cip_application_message_reads as reads', function ($join) use ($viewer) {
                $join->on('reads.application_id', '=', 'cip_application_messages.application_id')
                    ->where('reads.user_id', '=', $viewer->id);
            })
            ->whereIn('cip_applications.client_id', $clientIds)
            ->whereIn('cip_application_messages.lane', $lanes)
            ->where(function ($q) use ($viewer) {
                $q->whereNull('cip_application_messages.author_id')
                    ->orWhere('cip_application_messages.author_id', '!=', $viewer->id);
            })
            ->whereRaw('cip_application_messages.id > COALESCE(reads.last_read_id, 0)')
            ->groupBy('cip_applications.client_id')
            ->selectRaw('cip_applications.client_id as client_id, COUNT(*) as n')
            ->pluck('n', 'client_id');

        $out = [];

        foreach ($rows as $clientId => $n) {
            $out[(int) $clientId] = (int) $n;
        }

        return $out;
    }

    public static function path(CipApplication $application): string
    {
        $application->loadMissing('client');

        if (! $application->client) {
            return Pages::home('q='.urlencode($application->displayNumber()));
        }

        return Pages::application($application->client->uid, 'tab=messages');
    }

    /** @return array<string, mixed> */
    public static function present(CipApplicationMessage $message, User $viewer): array
    {
        $author = ContactIdentity::present(
            $message->author,
            $message->companyMember,
            $message->author_name,
        );

        return [
            'id' => $message->uuid,
            'body' => $message->body,
            'lane' => $message->lane,
            'laneLabel' => $message->laneLabel(),
            'author' => [
                'name' => $author['name'],
                'email' => $author['email'],
                'avatar' => $author['avatar'],
            ],
            'mine' => ContactIdentity::isSelf(
                $viewer,
                $message->author_id,
                $message->company_member_id,
            ),
            'createdAt' => $message->created_at?->toIso8601String(),
        ];
    }

    private static function normaliseLane(string $lane, User $author): string
    {
        $lane = trim($lane);

        if ($lane === '') {
            return self::canPostInternal($author)
                ? CipApplicationMessage::LANE_INTERNAL
                : CipApplicationMessage::LANE_PROVIDER;
        }

        if (! in_array($lane, CipApplicationMessage::LANES, true)) {
            throw ValidationException::withMessages([
                'lane' => 'Choose Internal or Service provider.',
            ]);
        }

        return $lane;
    }

    private static function announce(CipApplication $application, CipApplicationMessage $message, User $author): void
    {
        $path = self::path($application);
        $url = rtrim(config('app.url'), '/').$path;
        $number = $application->displayNumber();
        $preview = Str::limit($message->body, 140);
        $title = $number.': new message';
        $email = $message->lane === CipApplicationMessage::LANE_PROVIDER;

        foreach (self::recipients($application, $message, $author) as $recipient) {
            if ($email) {
                Deliveries::send(
                    Postcards::notification(
                        $title,
                        $preview,
                        $url,
                        'Open Messages',
                        $recipient['name'] ? (strtok($recipient['name'], ' ') ?: $recipient['name']) : null,
                        'CIP Applications',
                    ),
                    $recipient['email'],
                    $application,
                    'cip-message',
                );
            }

            if ($recipient['userId'] === null) {
                continue;
            }

            Notifier::send([
                'user' => User::find($recipient['userId']),
                'actor' => $author,
                'type' => 'cip.message',
                'title' => $title,
                'message' => $preview,
                'subject' => $application,
                'action_url' => $path,
                'email' => false,
            ]);
        }
    }

    /**
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    private static function recipients(CipApplication $application, CipApplicationMessage $message, User $author): array
    {
        $pool = $message->lane === CipApplicationMessage::LANE_INTERNAL
            ? [...Contacts::administrators(), ...Contacts::assignedOfficers($application)]
            : (Role::isStaff($author)
                ? Contacts::providerSide($application)
                : [...Contacts::administrators(), ...Contacts::assignedOfficers($application)]);

        $out = [];

        foreach ($pool as $recipient) {
            $email = trim((string) ($recipient['email'] ?? ''));

            if ($email === '') {
                continue;
            }

            if ($recipient['userId'] !== null && (int) $recipient['userId'] === (int) $author->id) {
                continue;
            }

            if (mb_strtolower($email) === mb_strtolower((string) $author->email)) {
                continue;
            }

            $out[mb_strtolower($email)] = $recipient;
        }

        return array_values($out);
    }

    /**
     * @return list<int>
     */
    private static function recipientUserIds(CipApplication $application, CipApplicationMessage $message, User $author): array
    {
        $ids = [];

        foreach (self::recipients($application, $message, $author) as $recipient) {
            if ($recipient['userId']) {
                $ids[] = (int) $recipient['userId'];
            }
        }

        return array_values(array_unique($ids));
    }
}
