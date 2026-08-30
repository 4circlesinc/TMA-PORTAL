<?php

namespace Tests\Feature;

use App\Events\PortalDataChanged;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Realtime\Live;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Requests and Comments tiles on the portal home.
 *
 * The lists themselves are {@see WorkflowHubTest}'s subject — this is the same
 * code path, so what matters here is only what the board adds: that looking at
 * a tile is not the same as reading a thread, that a tile switched off costs
 * nothing, and that an account without the Workflows section is told so rather
 * than refused.
 */
class DashboardWorkTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-dashwork-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }

    private function user(string $type, string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function sharedFile(User $owner, string $name = 'Contract.txt'): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $owner->id, 'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent($name, 'draft one'),
            'folder' => $folder->uuid,
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    /**
     * A CIP slot marked Update required, visible to anyone who can see the
     * application. The strip must not treat this as unread work.
     */
    private function cipUpdateRequired(User $staff, ?CipProvider $provider = null): CipDocument
    {
        $provider ??= CipProvider::create([
            'name' => 'Private clients',
            'code' => 'PRI'.substr(uniqid(), -4),
        ]);
        $client = Client::create([
            'uid' => 'asem-'.uniqid(),
            'name' => 'Asem Habtoor',
            'created_by' => $staff->id,
            'data' => [],
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Habtoor',
        ]);
        $document = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => DocumentTypes::label(DocumentTypes::BIRTH_CERTIFICATE),
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Birth certificate.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/birth-'.uniqid().'.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
            'review_status' => DocumentStatus::UPDATE_REQUIRED,
            'review_note' => 'Please rescan the stamp.',
        ]);
        $document->forceFill([
            'file_id' => $file->id,
            'status' => DocumentStatus::UPDATE_REQUIRED,
            'status_changed_at' => now(),
        ])->save();

        return $document->fresh();
    }

    public function test_the_board_lists_what_is_waiting_on_you_and_who_is_talking_to_you(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonCount(1, 'requests')
            ->assertJsonPath('requests.0.file.name', 'Contract.txt')
            ->assertJsonPath('requests.0.headline.text', 'Your response is needed')
            ->assertJsonCount(1, 'comments')
            ->assertJsonPath('comments.0.author.name', 'Ada Admin')
            ->assertJsonPath('comments.0.mentionsMe', true)
            ->assertJsonPath('counts.waiting', 1);
    }

    /**
     * The one thing the board must not do.
     *
     * The tile shows a line of each thread and refreshes on a timer, so if
     * that counted as reading, a dashboard left open all day would empty the
     * Workflows badge for conversations nobody ever opened.
     */
    public function test_looking_at_the_tile_does_not_mark_the_threads_read(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben — thoughts?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 1);

        // Twice, because a poll is what this endpoint actually gets.
        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 1);

        /*
         * Nor does the Workflows list. It used to, and that made the state
         * impossible to draw: a card was already read by the time it reached
         * the screen, so unread and read cards looked alike. Listing is not
         * reading anywhere now — opening a thread is what reads it.
         */
        $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=mine')
            ->assertOk()
            ->assertJsonPath('items.0.unread', true);

        // Per row, because that is what the tile draws: a badge saying "1
        // unread" over five rows that all look alike answers nothing.
        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 1)
            ->assertJsonPath('comments.0.unread', true);

        // Opening one is.
        $comment = FileComment::query()->whereNull('parent_id')->firstOrFail();
        $this->actingAs($ben)
            ->postJson("/portal/files/workflows/comments/{$comment->uuid}/read")
            ->assertOk();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 0)
            // Still listed, and now visibly read — the row does not vanish
            // because it was opened.
            ->assertJsonPath('comments.0.unread', false);
    }

    /** A tile the reader turned off is not built. */
    public function test_want_narrows_what_is_returned(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=comments')
            ->assertOk()
            ->assertJsonPath('want', ['comments'])
            ->assertJsonCount(0, 'requests')
            ->assertJsonCount(1, 'comments');

        // Nonsense falls back to the whole board rather than an empty one.
        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=nothing')
            ->assertOk()
            ->assertJsonPath('want', ['requests', 'comments'])
            ->assertJsonCount(1, 'requests');
    }

    /** Ten rows a tile, however much discussion there is. */
    public function test_each_tile_is_capped_at_ten_rows(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        for ($i = 0; $i < 12; $i++) {
            $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
                'body' => "Point {$i}",
                'mentions' => [$ben->id],
            ])->assertCreated();
        }

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=comments')
            ->assertOk()
            ->assertJsonCount(10, 'comments')
            // Newest first, so the tile leads with what just happened.
            ->assertJsonPath('comments.0.body', 'Point 11');
    }

    /**
     * The strip under the KPIs is unread unresolved comments and requests
     * still waiting on you, newest first, and it stops at ten even when each
     * stream could fill it.
     */
    public function test_the_feed_combines_streams_newest_first_and_caps_at_ten(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->travel(2)->seconds();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'The later note',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $feed = $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonPath('want', ['feed'])
            ->assertJsonCount(0, 'requests')
            ->assertJsonCount(0, 'comments')
            ->assertJsonCount(2, 'feed')
            ->json('feed');

        $this->assertSame('comment', $feed[0]['kind']);
        $this->assertSame('The later note', $feed[0]['item']['body']);
        $this->assertSame('request', $feed[1]['kind']);
        $this->assertSame('Contract.txt', $feed[1]['item']['file']['name']);

        for ($i = 0; $i < 12; $i++) {
            $this->travel(1)->seconds();
            $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
                'body' => "Later {$i}",
                'mentions' => [$ben->id],
            ])->assertCreated();
        }

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonCount(10, 'feed')
            ->assertJsonPath('feed.0.kind', 'comment')
            ->assertJsonPath('feed.0.item.body', 'Later 11');
    }

    /** Asking for the tiles does not build the strip. */
    public function test_feed_is_opt_in(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Only on the tile',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=comments')
            ->assertOk()
            ->assertJsonCount(1, 'comments')
            ->assertJsonCount(0, 'feed');
    }

    /** Opening a thread takes it off the strip; the Comments tile still lists it. */
    public function test_the_feed_omits_comments_already_opened(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Please look at this',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed,comments')
            ->assertOk()
            ->assertJsonCount(1, 'feed')
            ->assertJsonPath('feed.0.item.body', 'Please look at this')
            ->assertJsonPath('comments.0.unread', true);

        $comment = FileComment::query()->whereNull('parent_id')->firstOrFail();
        $this->actingAs($ben)
            ->postJson("/portal/files/workflows/comments/{$comment->uuid}/read")
            ->assertOk();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed,comments')
            ->assertOk()
            ->assertJsonCount(0, 'feed')
            ->assertJsonCount(1, 'comments')
            ->assertJsonPath('comments.0.unread', false);
    }

    /** Resolving a thread takes it off the strip even if it is still unread. */
    public function test_the_feed_omits_resolved_comments(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $comment = $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Please look at this',
            'mentions' => [$ben->id],
        ])->assertCreated()->json();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonCount(1, 'feed');

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/comments/{$comment['id']}/resolve", [
                'resolved' => true,
            ])
            ->assertOk();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonCount(0, 'feed');
    }

    /**
     * CIP documents marked Update required stay on that Workflows page.
     * Every account that can see the application used to get them in the
     * strip — that is open work, not something unread for this person.
     */
    public function test_the_feed_omits_cip_updates_required(): void
    {
        config(['services.cip.enabled' => true]);

        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);
        $this->cipUpdateRequired($ada);

        $this->actingAs($ada)->getJson('/portal/files/workflows/updates')
            ->assertOk()
            ->assertJsonCount(1, 'items');

        $this->actingAs($ada)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonCount(0, 'feed');

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->travel(2)->seconds();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Please look at this',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $feed = $this->actingAs($ben)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->assertJsonCount(2, 'feed')
            ->json('feed');

        $this->assertSame(['comment', 'request'], array_column($feed, 'kind'));
        $this->assertSame('Please look at this', $feed[0]['item']['body']);
    }

    /**
     * The channels a piece of work signalled, so a test can ask "did this
     * reach that person" rather than only "did something fire".
     *
     * @return array<string, list<string>> resource => channel names
     */
    private function signals(callable $work): array
    {
        Event::fake([PortalDataChanged::class]);

        $work();
        // Signals are collected per request and sent on terminate; the test
        // kernel never terminates, so flush by hand.
        Live::flush();

        $out = [];

        foreach (Event::dispatched(PortalDataChanged::class) as $dispatched) {
            $event = $dispatched[0];
            foreach ($event->broadcastOn() as $channel) {
                $out[$event->resource][] = (string) $channel->name;
            }
        }

        return $out;
    }

    private function reached(array $signals, User $user): bool
    {
        foreach ($signals[Live::WORKFLOWS] ?? [] as $channel) {
            if (str_ends_with($channel, 'User.'.$user->id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The tiles are live, which means the writing half has to say so.
     *
     * Both tiles read one endpoint, so both ride one resource: a comment and
     * an approval each mean "ask again". The listening half is portal-home.js,
     * covered by dashboard-work.mjs.
     */
    public function test_a_comment_signals_everybody_the_thread_concerns(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Reviewing Officer', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($ada);

        $signals = $this->signals(function () use ($ada, $ben, $file) {
            $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
                'body' => 'Ben, can you check clause 4?',
                'mentions' => [$ben->id],
            ])->assertCreated();
        });

        $this->assertArrayHasKey(Live::WORKFLOWS, $signals);
        // The person named in it, and the author, whose own other tabs are
        // showing the same board.
        $this->assertTrue($this->reached($signals, $ben), 'the person named should be signalled');
        $this->assertTrue($this->reached($signals, $ada), 'the author should be signalled');
        /*
         * And nobody else. A signal per staff member on every comment written
         * anywhere in the firm would have every open board refetching all day
         * for conversations it is never going to draw.
         */
        $this->assertFalse($this->reached($signals, $cara), 'an uninvolved colleague should not be');
    }

    /** Answering one moves the sender's tile, not just the responder's. */
    public function test_answering_a_request_signals_the_people_on_it(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Reviewing Officer', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($ada);

        $sent = $this->signals(function () use ($ada, $ben, $file) {
            $this->actingAs($ada)
                ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                    'type' => 'approval',
                    'recipients' => [['userId' => $ben->id]],
                ])->assertCreated();
        });

        $this->assertTrue($this->reached($sent, $ben), 'the person asked should be signalled');
        $this->assertFalse($this->reached($sent, $cara), 'somebody not on the request should not be');

        $workflow = $this->actingAs($ben)
            ->getJson('/portal/dashboard/work')->assertOk()->json('requests.0.id');

        $answered = $this->signals(function () use ($ben, $file, $workflow) {
            $this->actingAs($ben)
                ->postJson("/portal/files/files/{$file->uuid}/workflows/{$workflow}/respond", [
                    'action' => 'approve',
                ])->assertOk();
        });

        // The sender is the one waiting to hear, so their board has to move.
        $this->assertTrue($this->reached($answered, $ada), 'the sender should be signalled');
    }

    /** Reading is a change too, but only to the reader's own tabs. */
    public function test_reading_a_thread_signals_only_the_reader(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $comment = $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben — thoughts?',
            'mentions' => [$ben->id],
        ])->assertCreated()->json();

        $signals = $this->signals(function () use ($ben, $comment) {
            $this->actingAs($ben)
                ->postJson("/portal/files/workflows/comments/{$comment['id']}/read")
                ->assertOk();
        });

        $this->assertTrue($this->reached($signals, $ben), 'the reader\'s own tabs should be signalled');
        // Nothing about the thread changed for anyone else.
        $this->assertFalse($this->reached($signals, $ada), 'nobody else should hear about it');
    }

    /** Asking for the tiles must never signal — that is a refetch loop. */
    public function test_loading_the_board_signals_nothing(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $signals = $this->signals(function () use ($ben) {
            $this->actingAs($ben)->getJson('/portal/dashboard/work')->assertOk();
            $this->actingAs($ben)->getJson('/portal/dashboard/work')->assertOk();
        });

        $this->assertSame([], $signals);
    }

    /**
     * A client has no Workflows section, so the board is told to drop the
     * tiles rather than refused — a 403 would be indistinguishable from the
     * tiles being broken.
     */
    public function test_an_account_without_the_section_is_told_so_rather_than_refused(): void
    {
        $client = $this->user('Client', 'cliff@example.com', 'Cliff Client');

        $this->actingAs($client)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('enabled', false)
            ->assertJsonCount(0, 'requests')
            ->assertJsonCount(0, 'comments');
    }

    /**
     * A Service Provider contact is still a Client account type, but they
     * reach Workflows, so the board has to serve the same tiles the page
     * opens onto rather than claiming the section is closed.
     */
    public function test_a_service_provider_contact_gets_the_work_tiles(): void
    {
        config(['services.cip.enabled' => true]);

        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $gil = $this->user('Client', 'gil@example.com', 'Gil Contact');
        $company = Company::create(['uid' => 'gal-dash', 'name' => 'Galaxy Firm']);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $gil->id,
            'name' => $gil->name,
            'email' => $gil->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $provider = CipProvider::create([
            'name' => 'Galaxy', 'code' => 'GLD', 'company_id' => $company->id,
        ]);
        $this->cipUpdateRequired($ada, $provider);

        $this->actingAs($gil)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('enabled', true);

        $this->actingAs($gil)->getJson('/portal/files/workflows/updates')
            ->assertOk()
            ->assertJsonCount(1, 'items');

        $feed = $this->actingAs($gil)->getJson('/portal/dashboard/work?want=feed')
            ->assertOk()
            ->json('feed');

        $this->assertNotContains('update', array_column($feed, 'kind'));
        $this->assertCount(0, $feed);
    }
}
