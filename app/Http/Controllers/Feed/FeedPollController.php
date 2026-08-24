<?php

namespace App\Http\Controllers\Feed;

use App\Events\FeedPostChanged;
use App\Http\Controllers\Controller;
use App\Models\FeedPoll;
use App\Models\FeedPollVote;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Voting in polls, and closing them (§13).
 *
 * Anonymity is about who is *named*, never about what is counted: an
 * anonymous poll still stores the voter id, because without it one person
 * could vote repeatedly and the result would be worthless. Nothing in this
 * controller or the presenter ever reports a voter for an anonymous poll.
 */
class FeedPollController extends Controller
{
    /**
     * Cast, change or withdraw a vote.
     *
     * The whole ballot is sent each time, the options the voter wants held,
     * not a delta, so a single-choice poll and a multi-select behave the same
     * way and a lost request cannot leave a half-applied vote.
     */
    public function vote(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $uuid);
        $poll = $post->poll;

        abort_unless($poll, 404);
        abort_unless(FeedAccess::canEngage($post->channel, $user), 403, 'You cannot vote here.');

        if ($poll->isClosed()) {
            throw ValidationException::withMessages(['poll' => 'This poll has closed.']);
        }

        $data = $request->validate([
            'optionIds' => ['present', 'array', 'max:12'],
            'optionIds.*' => ['string'],
        ]);

        $options = $poll->options()->whereIn('uuid', $data['optionIds'])->get();

        if ($options->count() !== count($data['optionIds'])) {
            throw ValidationException::withMessages([
                'optionIds' => 'That option is no longer part of this poll.',
            ]);
        }

        if (! $poll->multiple_choice && $options->count() > 1) {
            throw ValidationException::withMessages([
                'optionIds' => 'This poll takes one answer.',
            ]);
        }

        DB::transaction(function () use ($poll, $user, $options) {
            // Clear the whole ballot first, then write what was chosen. That
            // makes a change of mind and a withdrawal the same operation.
            FeedPollVote::query()
                ->where('poll_id', $poll->id)
                ->where('user_id', $user->id)
                ->delete();

            foreach ($options as $option) {
                FeedPollVote::create([
                    'poll_id' => $poll->id,
                    'option_id' => $option->id,
                    'user_id' => $user->id,
                ]);
            }

            $this->recount($poll);
        });

        ActivityLogger::log([
            'type' => 'post.poll_voted',
            'actor' => $user,
            'description' => $user->name.' voted in a poll in '.$post->channel->name,
            'subject' => $post,
        ]);

        FeedPostChanged::dispatch($post->channel->uuid, 'voted', $post->uuid);

        $poll = $poll->fresh('options');

        return response()->json([
            'poll' => FeedPresenter::poll($poll, $user, $options->pluck('uuid')->all()),
        ]);
    }

    /**
     * Close a poll early. Its author, or a moderator of the channel.
     *
     * Closing is one-way: reopening would let a result that people have
     * already acted on quietly change afterwards.
     */
    public function close(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $uuid);
        $poll = $post->poll;

        abort_unless($poll, 404);
        abort_unless(
            $post->author_id === $user->id || FeedAccess::canModerate($post->channel, $user),
            403,
            'You cannot close this poll.'
        );

        if ($poll->isClosed()) {
            return response()->json(['poll' => FeedPresenter::poll($poll, $user, $this->myVotes($poll, $user->id))]);
        }

        $poll->forceFill(['closed_at' => Carbon::now()])->save();

        FeedPostChanged::dispatch($post->channel->uuid, 'voted', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.poll_closed',
            'actor' => $user,
            'description' => $user->name.' closed a poll in '.$post->channel->name,
            'subject' => $post,
        ]);

        return response()->json([
            'poll' => FeedPresenter::poll($poll->fresh('options'), $user, $this->myVotes($poll, $user->id)),
        ]);
    }

    /**
     * Who voted for what.
     *
     * Refused outright for an anonymous poll, not filtered, refused, so there
     * is no shape of request that returns a partial answer.
     */
    public function voters(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $uuid);
        $poll = $post->poll;

        abort_unless($poll, 404);
        abort_if($poll->is_anonymous, 403, 'This poll is anonymous.');

        $votes = $poll->votes()->with(['user', 'option'])->get();

        return response()->json([
            'options' => $poll->options->map(fn ($option) => [
                'id' => $option->uuid,
                'label' => $option->label,
                'people' => $votes->where('option_id', $option->id)
                    ->map(fn (FeedPollVote $v) => FeedPresenter::person($v->user))
                    ->filter()->values(),
            ])->values(),
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Recount a poll from its votes.
     *
     * Recount rather than increment for the same reason the channel counters
     * are recounted: a delta drifts, and these numbers are a result people act
     * on.
     */
    private function recount(FeedPoll $poll): void
    {
        foreach ($poll->options()->get() as $option) {
            $option->forceFill(['votes_count' => $option->votes()->count()])->save();
        }

        // The poll's own total is distinct voters, not ballots, otherwise a
        // multi-select poll reads as having more voters than it has people.
        $poll->forceFill([
            'votes_count' => $poll->votes()->distinct('user_id')->count('user_id'),
        ])->save();
    }

    /** @return array<int, string> the option uuids this user holds */
    private function myVotes(FeedPoll $poll, int $userId): array
    {
        return $poll->votes()
            ->where('user_id', $userId)
            ->with('option')
            ->get()
            ->pluck('option.uuid')
            ->filter()
            ->all();
    }
}
