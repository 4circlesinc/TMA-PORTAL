<?php

namespace App\Jobs;

use App\Events\FeedPostChanged;
use App\Models\FeedPost;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedNotifier;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Publish one scheduled post when its time arrives (§6).
 *
 * Claimed by id rather than by model so a job that has waited in the queue
 * re-reads the post as it stands now: an author who cancelled or rescheduled
 * in the meantime must win over a job that was enqueued before they did.
 *
 * The claim is a conditional update inside a transaction, which is what stops
 * two workers — or a retried job and a manual "publish now" — from publishing
 * the same post twice. If the row is no longer `scheduled`, this job has
 * nothing to do and says so.
 */
class PublishScheduledFeedPost implements ShouldQueue
{
    use Queueable;

    /** Retries, then the author is told it failed rather than left guessing. */
    public int $tries = 3;

    public function __construct(public int $postId) {}

    public function handle(): void
    {
        $post = FeedPost::query()->with('channel')->find($this->postId);

        if (! $post || ! $post->channel) {
            return;
        }

        if ($post->status !== FeedPost::STATUS_SCHEDULED) {
            // Cancelled, published by hand, or already done by another worker.
            return;
        }

        $channel = $post->channel;

        // An author who lost the right to post — left the channel, was
        // demoted, or the channel was archived — must not publish through a
        // job scheduled while they still could.
        if (! FeedAccess::canPost($channel, $post->author)) {
            $post->forceFill([
                'status' => FeedPost::STATUS_DRAFT,
                'scheduled_for' => null,
            ])->save();

            FeedNotifier::schedulePublished(
                $post,
                succeeded: false,
                reason: 'You no longer have permission to post in '.$channel->name.', so it was kept as a draft.',
            );

            return;
        }

        $claimed = DB::transaction(function () use ($post) {
            // Conditional on the status we read, so a concurrent publish loses.
            $rows = FeedPost::query()
                ->where('id', $post->id)
                ->where('status', FeedPost::STATUS_SCHEDULED)
                ->update([
                    'status' => FeedPost::STATUS_PUBLISHED,
                    'published_at' => Carbon::now(),
                    'scheduled_for' => null,
                    'updated_at' => Carbon::now(),
                ]);

            return $rows === 1;
        });

        if (! $claimed) {
            return;
        }

        $post->refresh();

        $channel->forceFill([
            'posts_count' => $channel->posts()->where('status', FeedPost::STATUS_PUBLISHED)->count(),
            'last_activity_at' => Carbon::now(),
        ])->save();

        FeedNotifier::postPublished($post);
        FeedNotifier::schedulePublished($post, succeeded: true);
        FeedPostChanged::dispatch($channel->uuid, 'created', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.published',
            'actor' => $post->author_id,
            'description' => ($post->author?->name ?? 'A scheduled post')
                .' published a scheduled post in '.$channel->name,
            'subject' => $post,
            'metadata' => ['scheduled' => true],
        ]);
    }

    /**
     * Every retry is spent. Put the post back in the author's hands rather
     * than leaving it stuck as "scheduled" for a time that has passed.
     */
    public function failed(\Throwable $e): void
    {
        Log::error('PublishScheduledFeedPost failed', [
            'post' => $this->postId,
            'error' => $e->getMessage(),
        ]);

        $post = FeedPost::find($this->postId);

        if (! $post || $post->status !== FeedPost::STATUS_SCHEDULED) {
            return;
        }

        $post->forceFill([
            'status' => FeedPost::STATUS_DRAFT,
            'scheduled_for' => null,
        ])->save();

        FeedNotifier::schedulePublished($post, succeeded: false);
    }
}
