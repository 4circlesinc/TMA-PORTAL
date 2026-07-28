<?php

namespace App\Support\Feed;

use App\Mail\Postcard;
use App\Models\FeedChannel;
use App\Models\FeedChannelMember;
use App\Models\FeedComment;
use App\Models\FeedPost;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Who hears about what happens in the Feed, and how (§7, §8).
 *
 * Publishing a post can raise portal notifications and send email, and the two
 * have deliberately different defaults: portal notifications go to the channel
 * unless the author turns them off, while email goes nowhere unless the author
 * explicitly chooses an audience. An internal feed that emails everyone by
 * default stops being read very quickly.
 *
 * Three rules hold throughout:
 *
 *  - **The author never notifies themselves.** Notifier already skips
 *    self-notification; the email side has to do it here.
 *  - **A mention beats a mute.** Someone who muted a channel still hears when
 *    they are named in it — that is the point of naming them.
 *  - **Recipients are recomputed at send time.** A group mention resolves to
 *    its members *now*, so somebody who joined the department after the post
 *    was written is still included.
 */
final class FeedNotifier
{
    /* ── Publishing ───────────────────────────────────────────────── */

    /**
     * Announce a newly published post: portal notifications first, then email.
     *
     * Never throws into the publish path. A post that went live but failed to
     * notify is a smaller problem than a publish that rolled back because the
     * mail queue was unreachable.
     */
    public static function postPublished(FeedPost $post): void
    {
        try {
            $channel = $post->channel;

            if (! $channel || ! $post->isPublished()) {
                return;
            }

            $mentioned = self::mentionedUsers($post);

            if ($post->notify_portal) {
                self::notifyChannel($post, $channel, $mentioned);
            }

            // Mentions are notified whatever the channel setting says.
            self::notifyMentioned($post, $channel, $mentioned);

            self::emailPost($post, $channel, $mentioned);
        } catch (\Throwable $e) {
            Log::error('FeedNotifier.postPublished failed', [
                'post' => $post->uuid,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The channel's members, minus the author, minus anyone who muted it.
     *
     * An announcement that demands acknowledgement uses its own type, so it
     * can carry a different icon and survive a reader who silenced ordinary
     * posts but not actions addressed to them.
     *
     * @param  Collection<int, User>  $mentioned  already notified separately
     */
    private static function notifyChannel(FeedPost $post, FeedChannel $channel, Collection $mentioned): void
    {
        $mentionedIds = $mentioned->pluck('id')->all();

        $recipients = $channel->members()
            ->with('user')
            ->where('user_id', '!=', $post->author_id)
            ->where('is_muted', false)
            ->get()
            ->pluck('user')
            ->filter()
            ->reject(fn (User $u) => in_array($u->id, $mentionedIds, true));

        if ($recipients->isEmpty()) {
            return;
        }

        $isAnnouncement = $post->post_type === FeedPost::TYPE_ANNOUNCEMENT;

        Notifier::sendToMany($recipients, [
            'type' => match (true) {
                $post->requires_acknowledgement => 'feed.acknowledgement',
                $isAnnouncement => 'feed.announcement',
                $post->post_type === FeedPost::TYPE_POLL => 'feed.poll',
                default => 'feed.post',
            },
            'actor' => $post->author_id,
            'title' => self::headline($post, $channel),
            'message' => FeedContent::excerpt($post->body, 160),
            'subject' => $post,
            'action_url' => self::postUrl($post),
            // One notification per post per reader, however many times a
            // scheduled publish is retried.
            'dedupe_key' => 'feed.post.'.$post->uuid,
        ]);
    }

    /**
     * Notify everyone named in the post, including via a group mention.
     *
     * @param  Collection<int, User>  $mentioned
     */
    private static function notifyMentioned(FeedPost $post, FeedChannel $channel, Collection $mentioned): void
    {
        $recipients = $mentioned->reject(fn (User $u) => $u->id === $post->author_id);

        if ($recipients->isEmpty()) {
            return;
        }

        Notifier::sendToMany($recipients, [
            'type' => 'feed.mention',
            'actor' => $post->author_id,
            'title' => ($post->author?->name ?? 'Someone').' mentioned you in '.$channel->name,
            'message' => FeedContent::excerpt($post->body, 160),
            'subject' => $post,
            'action_url' => self::postUrl($post),
            'dedupe_key' => 'feed.mention.'.$post->uuid,
        ]);
    }

    /* ── Comments ─────────────────────────────────────────────────── */

    /**
     * Tell the post's author, the thread's participants and anyone mentioned
     * that a comment landed (§8, §9).
     *
     * Each person hears once, at the most specific level that applies: being
     * named beats being replied to, which beats owning the post.
     */
    public static function commentAdded(FeedComment $comment): void
    {
        try {
            $post = $comment->post;
            $channel = $post?->channel;

            if (! $post || ! $channel) {
                return;
            }

            $author = $comment->author;
            $told = [$comment->author_id];

            $mentioned = self::mentionedUsers($comment);

            foreach ($mentioned as $user) {
                if (in_array($user->id, $told, true)) {
                    continue;
                }
                $told[] = $user->id;

                Notifier::send([
                    'user' => $user,
                    'type' => 'feed.mention',
                    'actor' => $comment->author_id,
                    'title' => ($author?->name ?? 'Someone').' mentioned you in a comment',
                    'message' => FeedContent::excerpt($comment->body, 160),
                    'subject' => $post,
                    'action_url' => self::postUrl($post),
                ]);
            }

            // A reply tells the person being replied to.
            if ($comment->isReply() && $comment->parent?->author_id) {
                $parentAuthorId = $comment->parent->author_id;

                if (! in_array($parentAuthorId, $told, true)) {
                    $told[] = $parentAuthorId;

                    Notifier::send([
                        'user' => $parentAuthorId,
                        'type' => 'feed.reply',
                        'actor' => $comment->author_id,
                        'title' => ($author?->name ?? 'Someone').' replied to your comment',
                        'message' => FeedContent::excerpt($comment->body, 160),
                        'subject' => $post,
                        'action_url' => self::postUrl($post),
                    ]);
                }
            }

            // And the post's author hears about any comment on their post.
            if (! in_array($post->author_id, $told, true)) {
                Notifier::send([
                    'user' => $post->author_id,
                    'type' => 'feed.comment',
                    'actor' => $comment->author_id,
                    'title' => ($author?->name ?? 'Someone').' commented on your post',
                    'message' => FeedContent::excerpt($comment->body, 160),
                    'subject' => $post,
                    'action_url' => self::postUrl($post),
                    // Ten comments in an hour is one notification, not ten.
                    'dedupe_key' => 'feed.comment.'.$post->uuid,
                    'dedupe_minutes' => 60,
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('FeedNotifier.commentAdded failed', [
                'comment' => $comment->uuid,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Tell an author their post was reacted to.
     *
     * Low priority and heavily de-duplicated: reactions arrive in bursts, and
     * one line saying a post is getting attention is worth more than twenty
     * saying it individually.
     */
    public static function reacted(FeedPost $post, User $actor, string $emoji): void
    {
        try {
            if ($post->author_id === $actor->id) {
                return;
            }

            Notifier::send([
                'user' => $post->author_id,
                'type' => 'feed.reaction',
                'actor' => $actor->id,
                'title' => $actor->name.' reacted '.$emoji.' to your post',
                'subject' => $post,
                'action_url' => self::postUrl($post),
                'dedupe_key' => 'feed.reaction.'.$post->uuid,
                'dedupe_minutes' => 120,
            ]);
        } catch (\Throwable $e) {
            Log::error('FeedNotifier.reacted failed', ['error' => $e->getMessage()]);
        }
    }

    /** Tell someone they were added to a channel. */
    public static function addedToChannel(FeedChannel $channel, User $user, ?User $actor): void
    {
        try {
            if ($actor && $actor->id === $user->id) {
                return;
            }

            Notifier::send([
                'user' => $user,
                'type' => 'feed.channel_invite',
                'actor' => $actor?->id,
                'title' => ($actor?->name ?? 'Someone').' added you to '.$channel->name,
                'message' => $channel->description
                    ? FeedContent::excerpt($channel->description, 120)
                    : null,
                'subject' => $channel,
                'action_url' => self::channelUrl($channel),
            ]);
        } catch (\Throwable $e) {
            Log::error('FeedNotifier.addedToChannel failed', ['error' => $e->getMessage()]);
        }
    }

    /** Tell an author their scheduled post went live — or that it could not. */
    public static function schedulePublished(FeedPost $post, bool $succeeded, ?string $reason = null): void
    {
        try {
            Notifier::send([
                'user' => $post->author_id,
                'type' => $succeeded ? 'feed.scheduled_published' : 'feed.schedule_failed',
                'title' => $succeeded
                    ? 'Your scheduled post is live in '.($post->channel?->name ?? 'the feed')
                    : 'Your scheduled post could not be published',
                'message' => $succeeded
                    ? FeedContent::excerpt($post->body, 160)
                    : ($reason ?: 'It has been kept as a draft so nothing was lost.'),
                'subject' => $post,
                'action_url' => self::postUrl($post),
            ]);
        } catch (\Throwable $e) {
            Log::error('FeedNotifier.schedulePublished failed', ['error' => $e->getMessage()]);
        }
    }

    /* ── Email (§7) ───────────────────────────────────────────────── */

    /**
     * Send the post's email notification, if the author chose an audience.
     *
     * `email_sent_at` makes this idempotent — a re-published or retried post
     * never mails the channel twice, which matters most for exactly the posts
     * that go to everyone.
     *
     * @param  Collection<int, User>  $mentioned
     */
    private static function emailPost(FeedPost $post, FeedChannel $channel, Collection $mentioned): void
    {
        if ($post->email_audience === FeedPost::EMAIL_NONE || $post->email_sent_at !== null) {
            return;
        }

        $recipients = self::emailRecipients($post, $channel, $mentioned)
            ->reject(fn (User $u) => $u->id === $post->author_id)
            ->unique('id');

        // Stamped before sending, not after: a crash midway through a large
        // fan-out must not re-mail everyone who already received it on retry.
        $post->forceFill(['email_sent_at' => Carbon::now()])->save();

        $url = self::postUrl($post, absolute: true);

        foreach ($recipients as $user) {
            try {
                Mail::to($user->email)->queue(self::postcard($post, $channel, $user, $url));
            } catch (\Throwable $e) {
                Log::error('FeedNotifier email failed', [
                    'post' => $post->uuid,
                    'user' => $user->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Resolve the chosen audience to actual people.
     *
     * A member whose per-channel `email_frequency` is `none` is dropped from
     * every audience except `mentioned` — muting a channel's email should not
     * be overridden by someone picking "everyone", but being named personally
     * is a different thing from channel traffic.
     *
     * @param  Collection<int, User>  $mentioned
     * @return Collection<int, User>
     */
    private static function emailRecipients(FeedPost $post, FeedChannel $channel, Collection $mentioned): Collection
    {
        return match ($post->email_audience) {
            FeedPost::EMAIL_MENTIONED => $mentioned,

            FeedPost::EMAIL_EVERYONE => User::query()
                ->where('status', User::STATUS_APPROVED)
                ->whereIn('account_type', Role::STAFF)
                ->get(),

            FeedPost::EMAIL_GROUPS => self::groupMembers($post->email_groups ?: []),

            // Members is the default reading of "notify the channel".
            default => $channel->members()
                ->with('user')
                ->where('email_frequency', '!=', FeedChannelMember::EMAIL_NONE)
                ->get()
                ->pluck('user')
                ->filter(),
        };
    }

    /**
     * Everyone in the named groups, resolved now rather than at write time.
     *
     * @param  array<int, string>  $groupUuids
     * @return Collection<int, User>
     */
    private static function groupMembers(array $groupUuids): Collection
    {
        if ($groupUuids === []) {
            return collect();
        }

        $groupIds = Group::query()->whereIn('uuid', $groupUuids)->pluck('id');

        return User::query()
            ->whereIn('id', GroupMember::query()->whereIn('group_id', $groupIds)->pluck('user_id'))
            ->where('status', User::STATUS_APPROVED)
            ->get();
    }

    /**
     * The email itself — the portal's one postcard design, never a bespoke
     * layout. §7 fixes its contents: channel, title or opening lines, author,
     * publish date, and a link that opens the post.
     */
    private static function postcard(FeedPost $post, FeedChannel $channel, User $recipient, string $url): Postcard
    {
        $author = $post->author?->name ?? 'Someone';
        $title = $post->title ?: FeedContent::excerpt($post->body, 80);
        $isAnnouncement = $post->post_type === FeedPost::TYPE_ANNOUNCEMENT;

        $details = [
            ['Channel', e($channel->name)],
            ['Posted by', e($author)],
            ['Published', e($post->published_at?->format('j F Y, g:i A') ?? 'Just now')],
        ];

        return new Postcard(
            ($isAnnouncement ? 'Announcement: ' : '').$title,
            [
                'preheader' => $author.' posted in '.$channel->name.'.',
                'eyebrow' => $isAnnouncement ? 'Announcement' : 'Feed',
                'greeting' => $recipient->first_name ? 'Hi '.$recipient->first_name.',' : null,
                'title' => $title,
                'lead' => $author.' posted in '.$channel->name.'.',
                'details' => $details,
                'quote' => FeedContent::excerpt($post->body, 400) ?: null,
                'button' => ['label' => 'Read the post', 'url' => $url],
            ],
        );
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Everyone named in a post or comment, with group mentions expanded to
     * their members as they stand right now.
     *
     * @return Collection<int, User>
     */
    private static function mentionedUsers(FeedPost|FeedComment $subject): Collection
    {
        $mentions = $subject->mentions()->with(['user', 'group'])->get();

        $direct = $mentions->pluck('user')->filter();

        $groupIds = $mentions->pluck('group_id')->filter()->unique();

        $viaGroups = $groupIds->isEmpty()
            ? collect()
            : User::query()
                ->whereIn('id', GroupMember::query()->whereIn('group_id', $groupIds)->pluck('user_id'))
                ->where('status', User::STATUS_APPROVED)
                ->get();

        return $direct->concat($viaGroups)->unique('id')->values();
    }

    /** The notification headline for a published post. */
    private static function headline(FeedPost $post, FeedChannel $channel): string
    {
        $author = $post->author?->name ?? 'Someone';

        return match ($post->post_type) {
            FeedPost::TYPE_ANNOUNCEMENT => 'Announcement in '.$channel->name,
            FeedPost::TYPE_POLL => $author.' started a poll in '.$channel->name,
            FeedPost::TYPE_QUESTION => $author.' asked a question in '.$channel->name,
            FeedPost::TYPE_PRAISE => $author.' shared praise in '.$channel->name,
            default => $author.' posted in '.$channel->name,
        };
    }

    /**
     * A deep link to one post. The Feed is a pushState view inside the portal
     * shell, so the link is to /social/feed with the post named in the query —
     * the page reads it on mount and opens straight to it.
     */
    public static function postUrl(FeedPost $post, bool $absolute = false): string
    {
        $path = '/social/feed?post='.$post->uuid;

        return $absolute ? url($path) : $path;
    }

    public static function channelUrl(FeedChannel $channel, bool $absolute = false): string
    {
        $path = '/social/feed?channel='.$channel->uuid;

        return $absolute ? url($path) : $path;
    }
}
