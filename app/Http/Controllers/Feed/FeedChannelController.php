<?php

namespace App\Http\Controllers\Feed;

use App\Http\Controllers\Controller;
use App\Models\Client;
use App\Models\FeedChannel;
use App\Models\FeedChannelMember;
use App\Models\FeedPost;
use App\Models\Group;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedNotifier;
use App\Support\Feed\FeedPresenter;
use App\Support\Files\FileType;
use App\Support\Files\FileValidationException;
use App\Support\Files\Vault;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Channels: creating them, editing them, and who belongs to them (§2, §3, §20).
 *
 * Every route resolves a channel through FeedAccess, which 404s rather than
 * 403s for a channel the caller cannot see, a private channel's existence is
 * itself information.
 */
class FeedChannelController extends Controller
{
    /**
     * Every channel this user can see, with their own membership on each.
     *
     * The sidebar renders from this one call, so it carries both the channels
     * someone belongs to and the org-wide ones they could join. Unread counts
     * are computed in one grouped query rather than per channel.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $channels = FeedAccess::scopeVisible(FeedChannel::query(), $user)
            ->with(['members' => fn ($q) => $q->where('user_id', $user->id), 'owner'])
            ->when(
                ! $request->boolean('includeArchived'),
                fn ($q) => $q->where('is_archived', false)
            )
            ->orderByDesc('last_activity_at')
            ->orderBy('name')
            ->get();

        $unread = $this->unreadCounts($channels, $user);

        return response()->json([
            'channels' => $channels
                ->map(fn (FeedChannel $c) => FeedPresenter::channel($c, $user, $unread[$c->id] ?? 0))
                ->values(),
            'can' => [
                'createChannel' => FeedAccess::canCreateChannel($user),
                'analytics' => FeedAccess::canViewAllAnalytics($user),
                'moderateAll' => FeedAccess::canModerateAll($user),
            ],
        ]);
    }

    /**
     * How many posts landed in each channel since the reader last opened it.
     *
     * One grouped query for every channel at once, the sidebar shows a dot
     * per channel, and doing this per channel was the slowest thing on the
     * page when the same pattern was used for messaging.
     *
     * @param  \Illuminate\Support\Collection<int, FeedChannel>  $channels
     * @return array<int, int> channel id => unread posts
     */
    private function unreadCounts($channels, User $user): array
    {
        $membershipIds = [];
        foreach ($channels as $channel) {
            $member = $channel->members->firstWhere('user_id', $user->id);
            if ($member) {
                $membershipIds[$channel->id] = $member->last_read_at;
            }
        }

        if ($membershipIds === []) {
            return [];
        }

        $counts = [];
        $rows = FeedPost::query()
            ->select('channel_id', DB::raw('count(*) as total'), 'published_at')
            ->whereIn('channel_id', array_keys($membershipIds))
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->where('author_id', '!=', $user->id)
            ->get(['channel_id', 'published_at']);

        foreach ($rows as $row) {
            $since = $membershipIds[$row->channel_id] ?? null;

            if ($since === null || ($row->published_at && $row->published_at->gt($since))) {
                $counts[$row->channel_id] = ($counts[$row->channel_id] ?? 0) + 1;
            }
        }

        return $counts;
    }

    /** One channel, with the header's counts. */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        $channel->load(['owner', 'client', 'group', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json([
            'channel' => FeedPresenter::channel($channel, $user),
        ]);
    }

    /**
     * Create a channel.
     *
     * The creator becomes its owner in the same transaction, a channel with
     * no owner has nobody who can manage or restore it, so the two are never
     * separate writes.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless(FeedAccess::canCreateChannel($user), 403, 'You cannot create channels.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'type' => ['required', Rule::in(FeedChannel::TYPES)],
            'visibility' => ['required', Rule::in(FeedChannel::VISIBILITIES)],
            'colour' => ['nullable', 'string', 'max:24'],
            'icon' => ['nullable', 'string', 'max:64'],
            'tags' => ['nullable', 'array', 'max:12'],
            'tags.*' => ['string', 'max:40'],
            'clientId' => ['nullable', 'string'],
            'groupId' => ['nullable', 'string'],
            'postPolicy' => ['nullable', Rule::in(FeedChannelMember::ROLES)],
            'commentPolicy' => ['nullable', Rule::in(FeedChannelMember::ROLES)],
            'joinPolicy' => ['nullable', Rule::in(['anyone', 'invite'])],
            // Seed membership, so a new team channel is usable immediately.
            'memberIds' => ['nullable', 'array', 'max:500'],
            'memberIds.*' => ['integer'],
        ]);

        // A company-wide channel reaches everyone, so it is an administrator's
        // to create, an employee making one would be an org-wide announcement
        // channel nobody approved.
        if ($data['type'] === FeedChannel::TYPE_COMPANY) {
            Role::authorizeAdmin($user);
        }

        $client = null;
        if (! empty($data['clientId'])) {
            Role::authorize($user, 'clients.view');
            $client = Client::query()->where('uuid', $data['clientId'])->firstOrFail();
        }

        $group = null;
        if (! empty($data['groupId'])) {
            Role::authorize($user, 'groups.view');
            $group = Group::query()->where('uuid', $data['groupId'])->firstOrFail();
        }

        $channel = DB::transaction(function () use ($data, $user, $client, $group) {
            $channel = FeedChannel::create([
                'uuid' => (string) Str::uuid(),
                'name' => $data['name'],
                'slug' => $this->uniqueSlug($data['name']),
                'description' => $data['description'] ?? null,
                'channel_type' => $data['type'],
                'visibility' => $data['visibility'],
                'colour' => $data['colour'] ?? 'blue',
                'icon' => $data['icon'] ?? 'Hash',
                'owner_id' => $user->id,
                'client_id' => $client?->id,
                'group_id' => $group?->id,
                'tags' => $data['tags'] ?? [],
                'post_policy' => $data['postPolicy'] ?? FeedChannelMember::ROLE_MEMBER,
                'comment_policy' => $data['commentPolicy'] ?? FeedChannelMember::ROLE_MEMBER,
                'join_policy' => $data['joinPolicy'] ?? 'anyone',
                'members_count' => 1,
                'last_activity_at' => Carbon::now(),
                'created_by' => $user->id,
            ]);

            $channel->members()->create([
                'user_id' => $user->id,
                'role' => FeedChannelMember::ROLE_OWNER,
                'joined_at' => Carbon::now(),
            ]);

            // A group-backed channel starts with that group's people in it.
            $seed = collect($data['memberIds'] ?? []);
            if ($group) {
                $seed = $seed->concat($group->members()->pluck('user_id'));
            }

            $this->addMembers($channel, $seed->unique()->all(), $user, FeedChannelMember::ROLE_MEMBER);

            return $channel;
        });

        ActivityLogger::log([
            'type' => 'channel.created',
            'actor' => $user,
            'description' => $user->name.' created the '.$channel->name.' channel',
            'subject' => $channel,
            'new' => ['name' => $channel->name, 'type' => $channel->channel_type, 'visibility' => $channel->visibility],
        ]);

        $channel->load(['owner', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json([
            'channel' => FeedPresenter::channel($channel, $user),
        ], 201);
    }

    /** Edit a channel's details. Administrators of the channel only. */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot edit this channel.');

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'colour' => ['sometimes', 'string', 'max:24'],
            'icon' => ['sometimes', 'string', 'max:64'],
            'visibility' => ['sometimes', Rule::in(FeedChannel::VISIBILITIES)],
            'tags' => ['sometimes', 'nullable', 'array', 'max:12'],
            'tags.*' => ['string', 'max:40'],
            'postPolicy' => ['sometimes', Rule::in(FeedChannelMember::ROLES)],
            'commentPolicy' => ['sometimes', Rule::in(FeedChannelMember::ROLES)],
            'joinPolicy' => ['sometimes', Rule::in(['anyone', 'invite'])],
        ]);

        $before = $channel->only(['name', 'description', 'visibility', 'colour', 'icon']);

        $channel->fill(array_filter([
            'name' => $data['name'] ?? null,
            'colour' => $data['colour'] ?? null,
            'icon' => $data['icon'] ?? null,
            'visibility' => $data['visibility'] ?? null,
            'post_policy' => $data['postPolicy'] ?? null,
            'comment_policy' => $data['commentPolicy'] ?? null,
            'join_policy' => $data['joinPolicy'] ?? null,
        ], fn ($v) => $v !== null));

        // Nullable fields are set separately: array_filter would drop a
        // deliberate "clear the description".
        if (array_key_exists('description', $data)) {
            $channel->description = $data['description'];
        }
        if (array_key_exists('tags', $data)) {
            $channel->tags = $data['tags'] ?? [];
        }

        $channel->save();

        ActivityLogger::log([
            'type' => 'channel.updated',
            'actor' => $user,
            'description' => $user->name.' updated the '.$channel->name.' channel',
            'subject' => $channel,
            'old' => $before,
            'new' => $channel->only(['name', 'description', 'visibility', 'colour', 'icon']),
        ]);

        $channel->load(['owner', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    /**
     * Replace the channel's profile picture or cover image.
     *
     * Stored through the File Library's vault like every other durable image,
     * and the previous file is removed once the new one is written, not
     * before, so a failed upload never leaves the channel without a picture.
     */
    public function updateImage(Request $request, string $uuid, string $which): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot edit this channel.');
        abort_unless(in_array($which, ['avatar', 'cover'], true), 404);

        $request->validate([
            'file' => ['required', 'file', 'image', 'max:10240'],
        ]);

        $file = $request->file('file');
        $absolute = $file->getRealPath();

        try {
            $inspected = FileType::inspect($absolute, $file->getClientOriginalName());
        } catch (FileValidationException $e) {
            throw ValidationException::withMessages(['file' => $e->getMessage()]);
        }

        $previousDisk = $which === 'avatar' ? $channel->avatar_disk : $channel->cover_disk;
        $previousPath = $which === 'avatar' ? $channel->avatar_path : $channel->cover_path;

        $stored = Vault::store($absolute, $inspected['extension'] ?? 'jpg');

        $channel->forceFill($which === 'avatar'
            ? ['avatar_disk' => $stored['disk'], 'avatar_path' => $stored['path']]
            : ['cover_disk' => $stored['disk'], 'cover_path' => $stored['path']]
        )->save();

        if ($previousPath) {
            try {
                Storage::disk($previousDisk ?: Vault::diskName())->delete($previousPath);
            } catch (\Throwable) {
                // An orphaned old image costs storage, not correctness.
            }
        }

        $channel->load(['owner', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    /**
     * Serve a channel's stored avatar or cover.
     *
     * Bytes are never public: access is re-checked here on every request, and
     * the disk the file lives on stays invisible to the client.
     */
    public function image(Request $request, string $uuid, string $which): StreamedResponse
    {
        $channel = $this->channelFor($request, $uuid);

        abort_unless(in_array($which, ['avatar', 'cover'], true), 404);

        $disk = $which === 'avatar' ? $channel->avatar_disk : $channel->cover_disk;
        $path = $which === 'avatar' ? $channel->avatar_path : $channel->cover_path;

        abort_unless($path, 404);

        $filesystem = Storage::disk($disk ?: Vault::diskName());
        abort_unless($filesystem->exists($path), 404);

        return $filesystem->response($path, null, [
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /* ── Membership ───────────────────────────────────────────────── */

    /** Who belongs to this channel, and at what rank. */
    public function members(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        $members = $channel->members()
            ->with('user')
            ->get()
            // Owner first, then administrators, then everyone alphabetically —
            // the order the members screen reads in.
            ->sortBy([
                fn (FeedChannelMember $m) => -$m->rank(),
                fn (FeedChannelMember $m) => $m->user?->name ?? '',
            ])
            ->values();

        return response()->json([
            'members' => $members->map(fn (FeedChannelMember $m) => FeedPresenter::member($m))->values(),
            'can' => ['manage' => FeedAccess::canManageChannel($channel, $user)],
        ]);
    }

    /** Join an open channel. */
    public function join(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canJoin($channel, $user), 403, 'You cannot join this channel.');

        $this->addMembers($channel, [$user->id], $user, FeedChannelMember::ROLE_MEMBER);

        $channel->refresh()->load(['owner', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    /** Leave a channel. The owner cannot; a default channel cannot be left. */
    public function leave(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canLeave($channel, $user), 403, 'You cannot leave this channel.');

        $channel->members()->where('user_id', $user->id)->delete();
        $this->recountMembers($channel);

        $channel->refresh()->load(['owner', 'members' => fn ($q) => $q->where('user_id', $user->id)]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    /** Add people to a channel. Channel administrators only. */
    public function addMembersRequest(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot manage this channel.');

        $data = $request->validate([
            'userIds' => ['required', 'array', 'max:500'],
            'userIds.*' => ['integer'],
            'role' => ['nullable', Rule::in(FeedChannelMember::ROLES)],
        ]);

        // Only the owner may hand out ownership, and never through this route.
        $role = $data['role'] ?? FeedChannelMember::ROLE_MEMBER;
        abort_if($role === FeedChannelMember::ROLE_OWNER, 422, 'Ownership is transferred, not granted.');

        $added = $this->addMembers($channel, $data['userIds'], $user, $role);

        return response()->json([
            'added' => $added,
            'channel' => FeedPresenter::channel($channel->refresh(), $user),
        ]);
    }

    /** Change a member's role. */
    public function updateMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot manage this channel.');

        $data = $request->validate([
            'role' => ['required', Rule::in(FeedChannelMember::ROLES)],
        ]);

        $member = $channel->members()->where('user_id', $userId)->firstOrFail();

        // The owner's own row is not editable here: a channel must always have
        // exactly one owner, so changing it is a transfer, not a role edit.
        abort_if($member->role === FeedChannelMember::ROLE_OWNER, 422, 'Transfer ownership instead.');
        abort_if(
            $data['role'] === FeedChannelMember::ROLE_OWNER,
            422,
            'Ownership is transferred, not granted.'
        );

        $member->forceFill(['role' => $data['role']])->save();

        ActivityLogger::log([
            'type' => 'channel.member_role_changed',
            'actor' => $user,
            'description' => $user->name.' made '.($member->user?->name ?? 'a member').' a '.$data['role'].' of '.$channel->name,
            'subject' => $channel,
            'new' => ['user_id' => $userId, 'role' => $data['role']],
        ]);

        return response()->json(['member' => FeedPresenter::member($member->fresh('user'))]);
    }

    /** Remove someone from a channel. */
    public function removeMember(Request $request, string $uuid, int $userId): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot manage this channel.');

        $member = $channel->members()->where('user_id', $userId)->firstOrFail();
        abort_if($member->role === FeedChannelMember::ROLE_OWNER, 422, 'The owner cannot be removed.');

        $member->delete();
        $this->recountMembers($channel);

        ActivityLogger::log([
            'type' => 'channel.member_removed',
            'actor' => $user,
            'description' => $user->name.' removed a member from '.$channel->name,
            'subject' => $channel,
            'old' => ['user_id' => $userId],
        ]);

        return response()->json(['removed' => true]);
    }

    /** Update the caller's own per-channel preferences (mute, email). */
    public function updateMyMembership(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        $member = $channel->members()->where('user_id', $user->id)->firstOrFail();

        $data = $request->validate([
            'muted' => ['sometimes', 'boolean'],
            'emailFrequency' => ['sometimes', Rule::in(FeedChannelMember::EMAIL_FREQUENCIES)],
        ]);

        if (array_key_exists('muted', $data)) {
            $member->is_muted = $data['muted'];
        }
        if (array_key_exists('emailFrequency', $data)) {
            $member->email_frequency = $data['emailFrequency'];
        }

        $member->save();

        return response()->json(['member' => FeedPresenter::member($member->fresh('user'))]);
    }

    /** Mark the channel read up to now, clearing its unread dot. */
    public function markRead(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        $channel->members()
            ->where('user_id', $user->id)
            ->update(['last_read_at' => Carbon::now()]);

        return response()->json(['ok' => true]);
    }

    /* ── Moderation (§20) ─────────────────────────────────────────── */

    /** Archive a channel: it stays readable, but takes no new posts. */
    public function archive(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot archive this channel.');

        $channel->forceFill([
            'is_archived' => true,
            'archived_at' => Carbon::now(),
            'archived_by' => $user->id,
        ])->save();

        ActivityLogger::log([
            'type' => 'channel.archived',
            'actor' => $user,
            'description' => $user->name.' archived the '.$channel->name.' channel',
            'subject' => $channel,
        ]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    public function restore(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canManageChannel($channel, $user), 403, 'You cannot restore this channel.');

        $channel->forceFill([
            'is_archived' => false,
            'archived_at' => null,
            'archived_by' => null,
        ])->save();

        ActivityLogger::log([
            'type' => 'channel.restored',
            'actor' => $user,
            'description' => $user->name.' restored the '.$channel->name.' channel',
            'subject' => $channel,
        ]);

        return response()->json(['channel' => FeedPresenter::channel($channel, $user)]);
    }

    /** Delete a channel outright. Owner or portal administrator. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $channel = $this->channelFor($request, $uuid);

        abort_unless(FeedAccess::canDeleteChannel($channel, $user), 403, 'You cannot delete this channel.');

        $name = $channel->name;
        // Soft delete: the posts inside it are a record, and a channel deleted
        // by mistake has to be recoverable.
        $channel->delete();

        ActivityLogger::log([
            'type' => 'channel.deleted',
            'actor' => $user,
            'description' => $user->name.' deleted the '.$name.' channel',
            'subject' => $channel,
            'old' => ['name' => $name],
        ]);

        return response()->json(['deleted' => true]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Resolve a channel the caller may see, or 404.
     *
     * Shared by every route here and used by the other Feed controllers too,
     * so the visibility rule is applied in exactly one place.
     */
    public static function resolve(Request $request, string $uuid): FeedChannel
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $channel = FeedChannel::query()
            ->with(['members' => fn ($q) => $q->where('user_id', $user->id)])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($channel, 404);
        FeedAccess::authorizeView($channel, $user);

        return $channel;
    }

    private function channelFor(Request $request, string $uuid): FeedChannel
    {
        return self::resolve($request, $uuid);
    }

    /**
     * Add people to a channel, skipping anyone already in it.
     *
     * Returns how many were actually added, so the caller can report "3 added"
     * rather than echoing the size of a list that was mostly existing members.
     *
     * @param  array<int, int>  $userIds
     */
    private function addMembers(FeedChannel $channel, array $userIds, User $actor, string $role): int
    {
        if ($userIds === []) {
            return 0;
        }

        $existing = $channel->members()->pluck('user_id')->all();
        $fresh = array_values(array_diff(array_unique($userIds), $existing));

        if ($fresh === []) {
            return 0;
        }

        // Only approved accounts, and clients only where the channel is theirs
        //, otherwise adding a member would be a way around channel visibility.
        $users = User::query()
            ->whereIn('id', $fresh)
            ->where('status', User::STATUS_APPROVED)
            ->get()
            ->filter(fn (User $u) => Role::isStaff($u)
                || $channel->visibility === FeedChannel::VISIBILITY_CLIENT);

        foreach ($users as $user) {
            $channel->members()->create([
                'user_id' => $user->id,
                'role' => $role,
                'joined_at' => Carbon::now(),
                'added_by' => $actor->id,
            ]);

            if ($user->id !== $actor->id) {
                FeedNotifier::addedToChannel($channel, $user, $actor);
            }
        }

        $this->recountMembers($channel);

        return $users->count();
    }

    /**
     * Recount a channel's members.
     *
     * Recount rather than increment: a counter nudged by a delta drifts the
     * first time two people are added and removed concurrently, and the number
     * is on the sidebar where a drift is visible forever.
     */
    private function recountMembers(FeedChannel $channel): void
    {
        $channel->forceFill(['members_count' => $channel->members()->count()])->save();
    }

    /** A URL-safe slug that no other channel holds. */
    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'channel';
        $slug = $base;
        $n = 2;

        while (FeedChannel::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$n++;
        }

        return $slug;
    }
}
