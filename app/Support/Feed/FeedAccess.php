<?php

namespace App\Support\Feed;

use App\Models\FeedChannel;
use App\Models\FeedChannelMember;
use App\Models\FeedComment;
use App\Models\FeedPost;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Who may see and do what inside the Feed, in one place.
 *
 * Two layers stack here, and keeping them apart is the whole point:
 *
 *  1. The portal's own capability model (App\Support\Access\Role) decides
 *     whether a person reaches the Feed at all — `feed.view` — and whether
 *     they may create channels or read firm-wide analytics.
 *  2. Inside the Feed, a channel's `visibility` plus the reader's membership
 *     row decides everything else. A portal administrator is treated as a
 *     channel administrator everywhere, because moderation (§20) has to work
 *     on a channel nobody remembered to add them to.
 *
 * Every check funnels through `member()` and `rank()` so a new action is one
 * comparison rather than a fresh interpretation of the rules. The controllers
 * never look at `account_type` or at a member's `role` string directly.
 */
final class FeedAccess
{
    /** Rung names, ascending. Mirrors FeedChannelMember::ROLES. */
    private const RANKS = [
        FeedChannelMember::ROLE_MEMBER => 0,
        FeedChannelMember::ROLE_MODERATOR => 1,
        FeedChannelMember::ROLE_ADMIN => 2,
        FeedChannelMember::ROLE_OWNER => 3,
    ];

    /* ── Portal-level gates ───────────────────────────────────────── */

    /** May this person reach the Feed at all? */
    public static function canUseFeed(?User $user): bool
    {
        return Role::can($user, 'feed.view');
    }

    /** May this person create a channel? */
    public static function canCreateChannel(?User $user): bool
    {
        return Role::can($user, 'feed.createChannel');
    }

    /** May this person see analytics across every channel, not just their own? */
    public static function canViewAllAnalytics(?User $user): bool
    {
        return Role::can($user, 'feed.analytics');
    }

    /** May this person moderate anywhere — the portal-wide override. */
    public static function canModerateAll(?User $user): bool
    {
        return Role::can($user, 'feed.moderate');
    }

    /* ── Channel membership and rank ──────────────────────────────── */

    /** The user's membership row for this channel, or null. */
    public static function member(FeedChannel $channel, ?User $user): ?FeedChannelMember
    {
        if (! $user) {
            return null;
        }

        return $channel->membershipFor($user);
    }

    /**
     * How much authority this user has in this channel, as a rung index.
     *
     * Returns -1 for a non-member. A portal-wide moderator floors at `admin`
     * even where they hold no membership — see the class comment.
     */
    public static function rank(FeedChannel $channel, ?User $user): int
    {
        if (! $user) {
            return -1;
        }

        $member = self::member($channel, $user);
        $rank = $member ? (self::RANKS[$member->role] ?? 0) : -1;

        if (self::canModerateAll($user)) {
            $rank = max($rank, self::RANKS[FeedChannelMember::ROLE_ADMIN]);
        }

        return $rank;
    }

    /** Does the user reach at least the named rung in this channel? */
    private static function atLeast(FeedChannel $channel, ?User $user, string $role): bool
    {
        return self::rank($channel, $user) >= (self::RANKS[$role] ?? 0);
    }

    public static function isMember(FeedChannel $channel, ?User $user): bool
    {
        return $user !== null && self::member($channel, $user) !== null;
    }

    /* ── The actions themselves ───────────────────────────────────── */

    /**
     * May this user read the channel and its posts?
     *
     * Membership always wins — a person added to a private channel keeps
     * seeing it. Otherwise `org` visibility opens the channel to staff, and a
     * client channel opens only to the people attached to that client.
     */
    public static function canView(FeedChannel $channel, ?User $user): bool
    {
        if (! self::canUseFeed($user)) {
            return false;
        }

        if (self::isMember($channel, $user) || self::canModerateAll($user)) {
            return true;
        }

        return match ($channel->visibility) {
            FeedChannel::VISIBILITY_ORG => Role::isStaff($user),
            // A client channel is never discoverable; you are added to it.
            // Private is members-only by definition.
            default => false,
        };
    }

    /**
     * May this user join without being invited?
     *
     * They must be able to see it, it must not be archived, and its
     * `join_policy` must be open. An existing member cannot "join" again.
     */
    public static function canJoin(FeedChannel $channel, ?User $user): bool
    {
        if (! self::canView($channel, $user) || $channel->is_archived) {
            return false;
        }

        if (self::isMember($channel, $user)) {
            return false;
        }

        return $channel->join_policy === 'anyone'
            && $channel->visibility === FeedChannel::VISIBILITY_ORG;
    }

    /**
     * May this user leave?
     *
     * The owner may not — a channel without an owner has nobody who can
     * restore it — and nobody may leave a default channel everyone belongs to.
     */
    public static function canLeave(FeedChannel $channel, ?User $user): bool
    {
        $member = self::member($channel, $user);

        return $member !== null
            && $member->role !== FeedChannelMember::ROLE_OWNER
            && ! $channel->is_default;
    }

    /**
     * May this user post here?
     *
     * Reading is not enough: posting needs membership *and* the rung the
     * channel's `post_policy` names. An archived channel takes no new posts
     * from anyone, including administrators — that is what archiving means.
     */
    public static function canPost(FeedChannel $channel, ?User $user): bool
    {
        if ($channel->is_archived || ! self::canView($channel, $user)) {
            return false;
        }

        if (! self::isMember($channel, $user) && ! self::canModerateAll($user)) {
            return false;
        }

        return self::atLeast($channel, $user, $channel->post_policy ?: FeedChannelMember::ROLE_MEMBER);
    }

    /** May this user comment on a post in this channel? */
    public static function canComment(FeedChannel $channel, FeedPost $post, ?User $user): bool
    {
        if ($channel->is_archived || ! self::canView($channel, $user)) {
            return false;
        }

        // A locked post takes no comments from anyone but a moderator, who may
        // still need to add the reason it was locked.
        if ($post->comments_locked && ! self::canModerate($channel, $user)) {
            return false;
        }

        if (! self::isMember($channel, $user) && ! self::canModerateAll($user)) {
            return false;
        }

        return self::atLeast($channel, $user, $channel->comment_policy ?: FeedChannelMember::ROLE_MEMBER);
    }

    /** Reacting, bookmarking, voting, acknowledging: anyone who can read it. */
    public static function canEngage(FeedChannel $channel, ?User $user): bool
    {
        return ! $channel->is_archived && self::canView($channel, $user);
    }

    /** Pin, unpin, lock comments, delete another person's post. */
    public static function canModerate(FeedChannel $channel, ?User $user): bool
    {
        return self::atLeast($channel, $user, FeedChannelMember::ROLE_MODERATOR);
    }

    /** Edit the channel, manage members, archive it. */
    public static function canManageChannel(FeedChannel $channel, ?User $user): bool
    {
        return self::atLeast($channel, $user, FeedChannelMember::ROLE_ADMIN);
    }

    /** Delete the channel outright. Owner or portal administrator only. */
    public static function canDeleteChannel(FeedChannel $channel, ?User $user): bool
    {
        if ($channel->is_system) {
            return false;
        }

        return self::atLeast($channel, $user, FeedChannelMember::ROLE_OWNER)
            || Role::isAdmin($user);
    }

    /** Read this channel's analytics. */
    public static function canViewAnalytics(FeedChannel $channel, ?User $user): bool
    {
        return self::canViewAllAnalytics($user) || self::canManageChannel($channel, $user);
    }

    /** Edit a post: its author, always; a moderator, never (they delete). */
    public static function canEditPost(FeedPost $post, ?User $user): bool
    {
        return $user !== null && $post->author_id === $user->id;
    }

    /** Delete a post: its author, or a moderator of its channel (§20). */
    public static function canDeletePost(FeedChannel $channel, FeedPost $post, ?User $user): bool
    {
        if ($user === null) {
            return false;
        }

        return $post->author_id === $user->id || self::canModerate($channel, $user);
    }

    public static function canEditComment(FeedComment $comment, ?User $user): bool
    {
        return $user !== null && $comment->author_id === $user->id;
    }

    public static function canDeleteComment(FeedChannel $channel, FeedComment $comment, ?User $user): bool
    {
        if ($user === null) {
            return false;
        }

        return $comment->author_id === $user->id || self::canModerate($channel, $user);
    }

    /* ── Bulk resolution ──────────────────────────────────────────── */

    /**
     * Constrain a channel query to what this user may see.
     *
     * This is the query-level twin of canView(): membership, or `org`
     * visibility for staff. Every cross-channel listing goes through it so a
     * private channel cannot surface in a search result or a bookmark list.
     */
    public static function scopeVisible(Builder $query, User $user): Builder
    {
        if (self::canModerateAll($user)) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->whereExists(function ($sub) use ($user) {
                $sub->select(DB::raw(1))
                    ->from('feed_channel_members')
                    ->whereColumn('feed_channel_members.channel_id', 'feed_channels.id')
                    ->where('feed_channel_members.user_id', $user->id);
            });

            if (Role::isStaff($user)) {
                $q->orWhere('feed_channels.visibility', FeedChannel::VISIBILITY_ORG);
            }
        });
    }

    /**
     * The ids of every channel this user may read.
     *
     * Cross-channel views (bookmarks, mentions, search, the "All channels"
     * stream) filter posts by this list rather than re-deriving visibility per
     * post, which would be one subquery per row.
     *
     * @return array<int, int>
     */
    public static function visibleChannelIds(User $user): array
    {
        return self::scopeVisible(FeedChannel::query(), $user)
            ->pluck('feed_channels.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * Refuse the request unless the user may read the channel.
     *
     * 404 rather than 403 on purpose: a private channel's existence is itself
     * information, and this mirrors how messaging resolves a conversation the
     * caller isn't in.
     */
    public static function authorizeView(FeedChannel $channel, ?User $user): void
    {
        abort_unless(self::canView($channel, $user), 404);
    }
}
