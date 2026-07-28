<?php

namespace Tests\Feature;

use App\Jobs\PublishScheduledFeedPost;
use App\Models\FeedAcknowledgement;
use App\Models\FeedChannel;
use App\Models\FeedComment;
use App\Models\FeedPost;
use App\Models\FeedReaction;
use App\Models\User;
use App\Support\Feed\FeedContent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The Feed module end to end: channels and their permissions, drafts,
 * scheduling, publishing, comments, reactions, polls, pinning, bookmarks,
 * acknowledgements, search and analytics.
 *
 * The permission cases matter most here — a channel that leaks is worse than
 * one that renders wrong — so each visibility rule is asserted from both
 * sides: the person who should see it, and the person who should not.
 */
class FeedTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $name = 'Staff Member'): User
    {
        return User::factory()->create([
            'name' => $name,
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function admin(): User
    {
        return User::factory()->create([
            'name' => 'Admin User',
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function client(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** Create a channel through the API, returning its uuid. */
    private function makeChannel(User $owner, array $overrides = []): string
    {
        $response = $this->actingAs($owner)->postJson('/portal/feed/channels', array_merge([
            'name' => 'General',
            'type' => FeedChannel::TYPE_TEAM,
            'visibility' => FeedChannel::VISIBILITY_ORG,
        ], $overrides));

        $response->assertCreated();

        return $response->json('channel.id');
    }

    /* ── Channels and permissions ─────────────────────────────────── */

    public function test_creating_a_channel_makes_the_creator_its_owner(): void
    {
        $staff = $this->staff();

        $response = $this->actingAs($staff)->postJson('/portal/feed/channels', [
            'name' => 'Marketing',
            'description' => 'Campaigns and launches',
            'type' => FeedChannel::TYPE_DEPARTMENT,
            'visibility' => FeedChannel::VISIBILITY_ORG,
            'colour' => 'green',
            'icon' => 'Megaphone',
            'tags' => ['campaigns'],
        ]);

        $response->assertCreated()
            ->assertJsonPath('channel.name', 'Marketing')
            ->assertJsonPath('channel.membership.role', 'owner')
            ->assertJsonPath('channel.memberCount', 1)
            ->assertJsonPath('channel.can.post', true)
            ->assertJsonPath('channel.can.manage', true);

        $this->assertDatabaseHas('feed_channels', ['name' => 'Marketing', 'slug' => 'marketing']);
    }

    public function test_a_client_cannot_reach_the_feed_at_all(): void
    {
        $this->actingAs($this->client())
            ->getJson('/portal/feed/channels')
            ->assertForbidden();
    }

    public function test_a_private_channel_is_invisible_to_a_non_member(): void
    {
        $owner = $this->staff('Owner');
        $outsider = $this->staff('Outsider');

        $uuid = $this->makeChannel($owner, [
            'name' => 'Leadership',
            'visibility' => FeedChannel::VISIBILITY_PRIVATE,
        ]);

        // 404, not 403: the channel's existence is itself information.
        $this->actingAs($outsider)->getJson("/portal/feed/channels/{$uuid}")->assertNotFound();

        $this->actingAs($outsider)
            ->getJson('/portal/feed/channels')
            ->assertOk()
            ->assertJsonCount(0, 'channels');
    }

    public function test_an_administrator_can_moderate_a_channel_they_were_never_added_to(): void
    {
        $owner = $this->staff('Owner');
        $admin = $this->admin();

        $uuid = $this->makeChannel($owner, ['visibility' => FeedChannel::VISIBILITY_PRIVATE]);

        $this->actingAs($admin)
            ->getJson("/portal/feed/channels/{$uuid}")
            ->assertOk()
            ->assertJsonPath('channel.can.moderate', true);
    }

    public function test_joining_and_leaving_an_open_channel(): void
    {
        $owner = $this->staff('Owner');
        $joiner = $this->staff('Joiner');
        $uuid = $this->makeChannel($owner);

        $this->actingAs($joiner)->postJson("/portal/feed/channels/{$uuid}/join")
            ->assertOk()
            ->assertJsonPath('channel.isMember', true)
            ->assertJsonPath('channel.memberCount', 2);

        $this->actingAs($joiner)->postJson("/portal/feed/channels/{$uuid}/leave")
            ->assertOk()
            ->assertJsonPath('channel.isMember', false)
            ->assertJsonPath('channel.memberCount', 1);
    }

    public function test_the_owner_cannot_leave_their_own_channel(): void
    {
        $owner = $this->staff();
        $uuid = $this->makeChannel($owner);

        $this->actingAs($owner)->postJson("/portal/feed/channels/{$uuid}/leave")->assertForbidden();
    }

    public function test_a_post_policy_of_moderator_stops_an_ordinary_member_posting(): void
    {
        $owner = $this->staff('Owner');
        $member = $this->staff('Member');

        $uuid = $this->makeChannel($owner, ['postPolicy' => 'moderator']);
        $this->actingAs($member)->postJson("/portal/feed/channels/{$uuid}/join")->assertOk();

        $this->actingAs($member)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Can I post?</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertForbidden();

        $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>The owner can.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated();
    }

    public function test_an_archived_channel_takes_no_new_posts(): void
    {
        $owner = $this->staff();
        $uuid = $this->makeChannel($owner);

        $this->actingAs($owner)->postJson("/portal/feed/channels/{$uuid}/archive")->assertOk();

        $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Still open?</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertForbidden();

        $this->actingAs($owner)->postJson("/portal/feed/channels/{$uuid}/restore")->assertOk();

        $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Open again.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated();
    }

    /* ── Posts, drafts, scheduling ────────────────────────────────── */

    public function test_publishing_a_post_and_reading_it_back(): void
    {
        $author = $this->staff('Author');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($author);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'title' => 'Quarter results',
            'body' => '<p>We beat the plan. <strong>Well done.</strong></p>',
            'type' => FeedPost::TYPE_ANNOUNCEMENT,
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated()->json('post');

        $this->assertSame('Quarter results', $post['title']);
        $this->assertSame('published', $post['status']);

        $this->actingAs($reader)
            ->getJson('/portal/feed/posts?channel='.$uuid)
            ->assertOk()
            ->assertJsonCount(1, 'posts')
            ->assertJsonPath('posts.0.title', 'Quarter results');
    }

    public function test_a_published_post_needs_content(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '   ',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertJsonValidationErrors('body');

        // A draft may be empty — that is what a draft is for.
        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '',
            'status' => FeedPost::STATUS_DRAFT,
        ])->assertCreated();
    }

    public function test_a_draft_is_private_to_its_author(): void
    {
        $author = $this->staff('Author');
        $other = $this->staff('Other');
        $uuid = $this->makeChannel($author);
        $this->actingAs($other)->postJson("/portal/feed/channels/{$uuid}/join");

        $draft = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Not ready yet.</p>',
            'status' => FeedPost::STATUS_DRAFT,
        ])->json('post');

        $this->actingAs($other)->getJson('/portal/feed/posts/'.$draft['id'])->assertNotFound();

        $this->actingAs($other)
            ->getJson('/portal/feed/posts?channel='.$uuid.'&view=drafts')
            ->assertOk()
            ->assertJsonCount(0, 'posts');

        $this->actingAs($author)
            ->getJson('/portal/feed/posts?channel='.$uuid.'&view=drafts')
            ->assertOk()
            ->assertJsonCount(1, 'posts');
    }

    public function test_autosave_updates_the_body_without_stamping_an_edit(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $draft = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Half a th</p>',
            'status' => FeedPost::STATUS_DRAFT,
        ])->json('post');

        $this->actingAs($author)->putJson('/portal/feed/posts/'.$draft['id'].'/autosave', [
            'body' => '<p>Half a thought, finished.</p>',
        ])->assertOk()->assertJsonStructure(['savedAt']);

        $stored = FeedPost::where('uuid', $draft['id'])->first();
        $this->assertStringContainsString('finished', $stored->body);
        $this->assertNull($stored->edited_at);
    }

    public function test_scheduling_requires_a_future_time_and_publishes_via_the_job(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Too late.</p>',
            'status' => FeedPost::STATUS_SCHEDULED,
            'scheduledFor' => now()->subHour()->toIso8601String(),
        ])->assertJsonValidationErrors('scheduledFor');

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Monday morning.</p>',
            'status' => FeedPost::STATUS_SCHEDULED,
            'scheduledFor' => now()->addHour()->toIso8601String(),
            'timezone' => 'Atlantic/Bermuda',
        ])->assertCreated()->json('post');

        $row = FeedPost::where('uuid', $post['id'])->first();
        $this->assertSame(FeedPost::STATUS_SCHEDULED, $row->status);

        (new PublishScheduledFeedPost($row->id))->handle();

        $row->refresh();
        $this->assertSame(FeedPost::STATUS_PUBLISHED, $row->status);
        $this->assertNotNull($row->published_at);
        $this->assertNull($row->scheduled_for);
    }

    public function test_the_publish_job_will_not_publish_the_same_post_twice(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Once only.</p>',
            'status' => FeedPost::STATUS_SCHEDULED,
            'scheduledFor' => now()->addMinutes(5)->toIso8601String(),
        ])->json('post');

        $row = FeedPost::where('uuid', $post['id'])->first();

        (new PublishScheduledFeedPost($row->id))->handle();
        $firstPublishedAt = $row->fresh()->published_at;

        // A retried job must find the row already claimed and do nothing.
        (new PublishScheduledFeedPost($row->id))->handle();

        $this->assertEquals($firstPublishedAt, $row->fresh()->published_at);
        $this->assertSame(1, FeedChannel::where('uuid', $uuid)->first()->posts_count);
    }

    public function test_publishing_immediately_from_a_draft(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $draft = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Ready now.</p>',
            'status' => FeedPost::STATUS_DRAFT,
        ])->json('post');

        $this->actingAs($author)->postJson('/portal/feed/posts/'.$draft['id'].'/publish')
            ->assertOk()
            ->assertJsonPath('post.status', 'published');
    }

    public function test_duplicating_a_post_always_produces_a_draft(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Reusable.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $copy = $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/duplicate')
            ->assertCreated()
            ->json('post');

        $this->assertSame('draft', $copy['status']);
        $this->assertNotSame($post['id'], $copy['id']);
    }

    public function test_editing_a_published_post_marks_it_edited(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>First draft of the truth.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($author)->patchJson('/portal/feed/posts/'.$post['id'], [
            'body' => '<p>Second draft of the truth.</p>',
        ])->assertOk()->assertJsonPath('post.edited', true);
    }

    public function test_only_the_author_can_edit_but_a_moderator_can_delete(): void
    {
        $author = $this->staff('Author');
        $moderator = $this->admin();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Mine.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($moderator)->patchJson('/portal/feed/posts/'.$post['id'], [
            'body' => '<p>Rewritten by someone else.</p>',
        ])->assertForbidden();

        $this->actingAs($moderator)->deleteJson('/portal/feed/posts/'.$post['id'])->assertOk();
        $this->assertSoftDeleted('feed_posts', ['uuid' => $post['id']]);
    }

    /* ── Content safety ───────────────────────────────────────────── */

    public function test_post_bodies_are_sanitised(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p onclick="steal()">Hello</p><script>alert(1)</script>'
                .'<a href="javascript:alert(2)">bad link</a>'
                .'<a href="https://example.com">good link</a>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated()->json('post');

        $body = $post['body'];

        $this->assertStringNotContainsString('<script', $body);
        $this->assertStringNotContainsString('onclick', $body);
        $this->assertStringNotContainsString('javascript:', $body);
        $this->assertStringContainsString('https://example.com', $body);
        // The text of a stripped link survives; only its href goes.
        $this->assertStringContainsString('bad link', $body);
        $this->assertStringContainsString('Hello', $body);
    }

    public function test_the_sanitiser_keeps_unicode_and_emoji_intact(): void
    {
        $this->assertStringContainsString('café 🎉', FeedContent::sanitise('<p>café 🎉</p>'));
    }

    /* ── Comments ─────────────────────────────────────────────────── */

    public function test_commenting_replying_and_locking(): void
    {
        $author = $this->staff('Author');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($author);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Thoughts?</p>',
            'type' => FeedPost::TYPE_QUESTION,
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $comment = $this->actingAs($reader)->postJson('/portal/feed/posts/'.$post['id'].'/comments', [
            'body' => '<p>Looks good to me.</p>',
        ])->assertCreated()->json('comment');

        $reply = $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/comments', [
            'body' => '<p>Thanks!</p>',
            'parentId' => $comment['id'],
        ])->assertCreated()->json('comment');

        $this->assertSame($comment['id'], $reply['parentId']);

        $tree = $this->actingAs($reader)
            ->getJson('/portal/feed/posts/'.$post['id'].'/comments')
            ->assertOk()
            ->json();

        $this->assertCount(1, $tree['comments']);
        $this->assertCount(1, $tree['comments'][0]['replies']);

        // Locking stops further comments from ordinary members.
        $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/lock')->assertOk();

        $this->actingAs($reader)->postJson('/portal/feed/posts/'.$post['id'].'/comments', [
            'body' => '<p>One more thing.</p>',
        ])->assertForbidden();
    }

    public function test_deleting_a_root_comment_takes_its_replies(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Thread starter.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $root = $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/comments', [
            'body' => '<p>Root.</p>',
        ])->json('comment');

        $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/comments', [
            'body' => '<p>Reply.</p>',
            'parentId' => $root['id'],
        ])->assertCreated();

        $this->actingAs($author)->deleteJson('/portal/feed/comments/'.$root['id'])
            ->assertOk()
            ->assertJsonPath('commentsCount', 0);

        $this->assertSame(0, FeedComment::whereNull('deleted_at')->count());
    }

    /* ── Reactions ────────────────────────────────────────────────── */

    public function test_reacting_changing_and_removing(): void
    {
        $author = $this->staff('Author');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($author);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>React to me.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $url = '/portal/feed/posts/'.$post['id'].'/reactions';

        $this->actingAs($reader)->postJson($url, ['emoji' => '👍'])
            ->assertOk()
            ->assertJsonPath('reactions.total', 1)
            ->assertJsonPath('reactions.mine', '👍');

        // A different emoji replaces, it does not stack.
        $this->actingAs($reader)->postJson($url, ['emoji' => '🎉'])
            ->assertOk()
            ->assertJsonPath('reactions.total', 1)
            ->assertJsonPath('reactions.mine', '🎉');

        $this->assertSame(1, FeedReaction::where('user_id', $reader->id)->count());

        // The same emoji again takes it back.
        $this->actingAs($reader)->postJson($url, ['emoji' => '🎉'])
            ->assertOk()
            ->assertJsonPath('reactions.total', 0);

        $this->assertSame(0, FeedReaction::where('user_id', $reader->id)->count());
    }

    public function test_who_reacted_is_listed(): void
    {
        $author = $this->staff('Author');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($author);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Hello.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($reader)->postJson('/portal/feed/posts/'.$post['id'].'/reactions', ['emoji' => '👍']);

        $this->actingAs($author)
            ->getJson('/portal/feed/posts/'.$post['id'].'/reactions')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('groups.0.people.0.name', 'Reader');
    }

    /* ── Polls ────────────────────────────────────────────────────── */

    public function test_voting_in_a_single_choice_poll_replaces_the_previous_vote(): void
    {
        $author = $this->staff('Author');
        $voter = $this->staff('Voter');
        $uuid = $this->makeChannel($author);
        $this->actingAs($voter)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Pick one.</p>',
            'type' => FeedPost::TYPE_POLL,
            'status' => FeedPost::STATUS_PUBLISHED,
            'poll' => [
                'question' => 'Where should the offsite be?',
                'options' => ['Lisbon', 'Reykjavik', 'Cape Town'],
            ],
        ])->assertCreated()->json('post');

        $options = $post['poll']['options'];
        $url = '/portal/feed/posts/'.$post['id'].'/poll/vote';

        $this->actingAs($voter)->postJson($url, ['optionIds' => [$options[0]['id']]])
            ->assertOk()
            ->assertJsonPath('poll.totalVotes', 1)
            ->assertJsonPath('poll.options.0.votes', 1);

        // Changing the vote moves it rather than adding one.
        $this->actingAs($voter)->postJson($url, ['optionIds' => [$options[1]['id']]])
            ->assertOk()
            ->assertJsonPath('poll.totalVotes', 1)
            ->assertJsonPath('poll.options.0.votes', 0)
            ->assertJsonPath('poll.options.1.votes', 1);

        // Two options in a single-choice poll is refused.
        $this->actingAs($voter)->postJson($url, [
            'optionIds' => [$options[0]['id'], $options[1]['id']],
        ])->assertJsonValidationErrors('optionIds');
    }

    public function test_a_closed_poll_takes_no_votes(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Quick poll.</p>',
            'type' => FeedPost::TYPE_POLL,
            'status' => FeedPost::STATUS_PUBLISHED,
            'poll' => ['question' => 'Yes or no?', 'options' => ['Yes', 'No']],
        ])->json('post');

        $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/poll/close')->assertOk();

        $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/poll/vote', [
            'optionIds' => [$post['poll']['options'][0]['id']],
        ])->assertJsonValidationErrors('poll');
    }

    public function test_an_anonymous_poll_refuses_to_name_its_voters(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Say what you really think.</p>',
            'type' => FeedPost::TYPE_POLL,
            'status' => FeedPost::STATUS_PUBLISHED,
            'poll' => [
                'question' => 'Is the process working?',
                'options' => ['Yes', 'No'],
                'anonymous' => true,
            ],
        ])->json('post');

        $this->actingAs($author)
            ->getJson('/portal/feed/posts/'.$post['id'].'/poll/voters')
            ->assertForbidden();
    }

    /* ── Pinning, bookmarks, acknowledgements ─────────────────────── */

    public function test_pinned_posts_come_back_in_their_own_band(): void
    {
        $owner = $this->staff();
        $uuid = $this->makeChannel($owner);

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Read this first.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($owner)->postJson('/portal/feed/posts/'.$post['id'].'/pin')
            ->assertOk()
            ->assertJsonPath('post.isPinned', true);

        $this->actingAs($owner)
            ->getJson('/portal/feed/posts?channel='.$uuid)
            ->assertOk()
            ->assertJsonCount(1, 'pinned');

        $this->actingAs($owner)->postJson('/portal/feed/posts/'.$post['id'].'/pin')
            ->assertOk()
            ->assertJsonPath('post.isPinned', false);
    }

    public function test_an_ordinary_member_cannot_pin(): void
    {
        $owner = $this->staff('Owner');
        $member = $this->staff('Member');
        $uuid = $this->makeChannel($owner);
        $this->actingAs($member)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Ordinary.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($member)->postJson('/portal/feed/posts/'.$post['id'].'/pin')->assertForbidden();
    }

    public function test_bookmarks_toggle_and_appear_in_their_own_view(): void
    {
        $owner = $this->staff();
        $uuid = $this->makeChannel($owner);

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Worth saving.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($owner)->postJson('/portal/feed/posts/'.$post['id'].'/bookmark')
            ->assertOk()->assertJsonPath('bookmarked', true);

        $this->actingAs($owner)
            ->getJson('/portal/feed/posts?view=bookmarks')
            ->assertOk()
            ->assertJsonCount(1, 'posts')
            ->assertJsonPath('posts.0.bookmarked', true);

        $this->actingAs($owner)->postJson('/portal/feed/posts/'.$post['id'].'/bookmark')
            ->assertOk()->assertJsonPath('bookmarked', false);

        $this->actingAs($owner)
            ->getJson('/portal/feed/posts?view=bookmarks')
            ->assertJsonCount(0, 'posts');
    }

    public function test_acknowledging_an_announcement_and_its_statistics(): void
    {
        $owner = $this->staff('Owner');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($owner);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'title' => 'New expenses policy',
            'body' => '<p>Please read and confirm.</p>',
            'type' => FeedPost::TYPE_ANNOUNCEMENT,
            'status' => FeedPost::STATUS_PUBLISHED,
            'requiresAcknowledgement' => true,
        ])->json('post');

        $this->actingAs($reader)->postJson('/portal/feed/posts/'.$post['id'].'/acknowledge')
            ->assertOk()
            ->assertJsonPath('acknowledged', true);

        // Acknowledging twice is a double-click, not an error.
        $this->actingAs($reader)->postJson('/portal/feed/posts/'.$post['id'].'/acknowledge')->assertOk();
        $this->assertSame(1, FeedAcknowledgement::count());

        $stats = $this->actingAs($owner)
            ->getJson('/portal/feed/posts/'.$post['id'].'/acknowledgements')
            ->assertOk()
            ->json();

        $this->assertCount(1, $stats['acknowledged']);
        // The owner has not acknowledged their own announcement yet.
        $this->assertCount(1, $stats['outstanding']);
    }

    public function test_taking_a_link_counts_as_a_share(): void
    {
        $owner = $this->staff();
        $uuid = $this->makeChannel($owner);

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Pass it on.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->assertSame(0, $post['counts']['shares']);

        $this->actingAs($owner)->postJson('/portal/feed/posts/'.$post['id'].'/share')
            ->assertOk()
            ->assertJsonPath('shares', 1);
    }

    /* ── Mentions, hashtags, search ───────────────────────────────── */

    public function test_a_mention_is_recorded_and_surfaces_in_the_mentions_view(): void
    {
        $author = $this->staff('Author');
        $mentioned = $this->staff('Mentioned Person');
        $uuid = $this->makeChannel($author);
        $this->actingAs($mentioned)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Over to <span data-mention="user:'.$mentioned->id.'">@Mentioned Person</span> on this.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated()->json('post');

        $this->assertDatabaseHas('feed_mentions', ['user_id' => $mentioned->id]);

        $this->actingAs($mentioned)
            ->getJson('/portal/feed/posts?view=mentions')
            ->assertOk()
            ->assertJsonCount(1, 'posts')
            ->assertJsonPath('posts.0.id', $post['id']);

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $mentioned->id,
            'type' => 'feed.mention',
        ]);
    }

    public function test_hashtags_are_indexed_and_filterable(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Kicking off #Q3Planning today.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated();

        $this->assertDatabaseHas('feed_hashtags', ['tag' => 'q3planning', 'posts_count' => 1]);

        $this->actingAs($author)
            ->getJson('/portal/feed/posts?hashtag=q3planning')
            ->assertOk()
            ->assertJsonCount(1, 'posts');

        // Case folding: #Q3Planning and #q3planning are one topic.
        $this->actingAs($author)
            ->getJson('/portal/feed/hashtags?q=q3')
            ->assertOk()
            ->assertJsonPath('results.0.count', 1);
    }

    public function test_search_covers_posts_and_comments_but_not_private_channels(): void
    {
        $insider = $this->staff('Insider');
        $outsider = $this->staff('Outsider');

        $private = $this->makeChannel($insider, [
            'name' => 'Confidential',
            'visibility' => FeedChannel::VISIBILITY_PRIVATE,
        ]);

        $this->actingAs($insider)->postJson('/portal/feed/posts', [
            'channelId' => $private,
            'body' => '<p>The pelican restructure is confirmed.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated();

        $this->actingAs($insider)
            ->getJson('/portal/feed/search?q=pelican')
            ->assertOk()
            ->assertJsonCount(1, 'posts');

        $this->actingAs($outsider)
            ->getJson('/portal/feed/search?q=pelican')
            ->assertOk()
            ->assertJsonCount(0, 'posts');
    }

    public function test_the_mention_autocomplete_returns_usable_tokens(): void
    {
        $staff = $this->staff('Findable Person');
        $uuid = $this->makeChannel($staff);

        $this->actingAs($staff)
            ->getJson('/portal/feed/mentionable?q=Findable&channel='.$uuid)
            ->assertOk()
            ->assertJsonPath('results.0.token', 'user:'.$staff->id)
            ->assertJsonPath('results.0.isMember', true);
    }

    /* ── Email fan-out ────────────────────────────────────────────── */

    public function test_email_is_only_sent_when_an_audience_is_chosen(): void
    {
        Mail::fake();

        $author = $this->staff('Author');
        $member = $this->staff('Member');
        $uuid = $this->makeChannel($author);
        $this->actingAs($member)->postJson("/portal/feed/channels/{$uuid}/join");

        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>No email for this one.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->assertCreated();

        Mail::assertNothingQueued();

        $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'title' => 'Office closed Monday',
            'body' => '<p>Enjoy the long weekend.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
            'emailAudience' => FeedPost::EMAIL_MEMBERS,
        ])->assertCreated();

        // The author is never mailed their own post.
        Mail::assertQueued(\App\Mail\Postcard::class, 1);
    }

    public function test_an_ordinary_member_cannot_email_everyone(): void
    {
        $owner = $this->staff('Owner');
        $member = $this->staff('Member');
        $uuid = $this->makeChannel($owner);
        $this->actingAs($member)->postJson("/portal/feed/channels/{$uuid}/join");

        $this->actingAs($member)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Everybody look at me.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
            'emailAudience' => FeedPost::EMAIL_EVERYONE,
        ])->assertJsonValidationErrors('emailAudience');
    }

    /* ── Analytics ────────────────────────────────────────────────── */

    public function test_analytics_separate_views_from_reach(): void
    {
        $owner = $this->staff('Owner');
        $reader = $this->staff('Reader');
        $uuid = $this->makeChannel($owner);
        $this->actingAs($reader)->postJson("/portal/feed/channels/{$uuid}/join");

        $post = $this->actingAs($owner)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Measured.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        // One person opening it three times is three views, reach of one.
        $this->actingAs($reader)->getJson('/portal/feed/posts/'.$post['id']);
        $this->actingAs($reader)->getJson('/portal/feed/posts/'.$post['id']);
        $this->actingAs($reader)->getJson('/portal/feed/posts/'.$post['id']);

        $analytics = $this->actingAs($owner)
            ->getJson('/portal/feed/analytics?channel='.$uuid)
            ->assertOk()
            ->json();

        $this->assertSame(3, $analytics['totals']['views']);
        $this->assertSame(1, $analytics['totals']['reach']);
        $this->assertSame(1, $analytics['totals']['posts']);
    }

    public function test_analytics_are_refused_to_someone_who_administers_nothing(): void
    {
        $owner = $this->staff('Owner');
        $member = $this->staff('Member');
        $uuid = $this->makeChannel($owner);
        $this->actingAs($member)->postJson("/portal/feed/channels/{$uuid}/join");

        $this->actingAs($member)->getJson('/portal/feed/analytics?channel='.$uuid)->assertForbidden();
        $this->actingAs($member)->getJson('/portal/feed/analytics')->assertForbidden();
    }

    /* ── Activity logging ─────────────────────────────────────────── */

    public function test_the_audit_trail_records_channel_and_post_events(): void
    {
        $author = $this->staff();
        $uuid = $this->makeChannel($author);

        $post = $this->actingAs($author)->postJson('/portal/feed/posts', [
            'channelId' => $uuid,
            'body' => '<p>Audited.</p>',
            'status' => FeedPost::STATUS_PUBLISHED,
        ])->json('post');

        $this->actingAs($author)->postJson('/portal/feed/posts/'.$post['id'].'/pin');

        // The column is `activity_type`; `type` is what the logger's API calls it.
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'channel.created', 'module' => 'feed']);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'post.published', 'module' => 'feed']);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'post.pinned', 'module' => 'feed']);
    }
}
