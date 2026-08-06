<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Message;
use App\Models\Report;
use App\Models\User;
use App\Support\Reports\ReportRunner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settings → Account and Reporting → Reporting.
 *
 * The page used to file a name and a date into localStorage, so the things
 * worth pinning here are the ones that make a report a report: that the
 * numbers come from real rows, that the date window actually excludes what
 * falls outside it, and that a recurring report rolls its window forward
 * instead of restating the figures it was created with.
 */
class ReportingTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', string $email = 'admin@example.com'): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** A file of a given size, uploaded on a given day. */
    private function file(User $owner, int $size, string $ago = '0 days'): FileItem
    {
        $folder = Folder::firstOrCreate(
            ['owner_id' => $owner->id, 'name' => 'Docs'],
            ['uuid' => (string) Str::uuid(), 'created_by' => $owner->id],
        );

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
            'name' => 'brief-'.Str::random(4).'.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => $size,
            'disk' => 'local',
            'storage_path' => 'files/'.Str::random(8).'.pdf',
        ]);

        // created_at is not fillable, so it is backdated after the insert.
        $file->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();

        return $file;
    }

    private function signIn(User $user, string $ago = '0 days'): void
    {
        $log = ActivityLog::create([
            'uid' => (string) Str::ulid(),
            'actor_id' => $user->id,
            'activity_type' => 'security.login',
            'module' => 'security',
            'action' => 'login',
            'description' => $user->name.' signed in',
        ]);

        $log->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();
    }

    private function message(User $sender, string $ago = '0 days'): Message
    {
        $conversation = Conversation::firstOrCreate(
            ['created_by' => $sender->id, 'type' => Conversation::TYPE_DIRECT],
            ['last_message_at' => now()],
        );

        ConversationParticipant::firstOrCreate([
            'conversation_id' => $conversation->id,
            'user_id' => $sender->id,
        ], ['role' => ConversationParticipant::ROLE_MEMBER, 'joined_at' => now()]);

        $message = Message::create([
            'conversation_id' => $conversation->id,
            'user_id' => $sender->id,
            'type' => Message::TYPE_TEXT,
            'body' => 'x',
        ]);

        $message->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();

        return $message;
    }

    private function create(User $as, array $body = []): array
    {
        return $this->actingAs($as)
            ->postJson('/admin/reports', array_merge(['type' => 'usage', 'range' => 'last_30'], $body))
            ->assertCreated()
            ->json('report');
    }

    /** A metric's value, by label. */
    private function metric(array $report, string $label): ?string
    {
        foreach ($report['data']['metrics'] ?? [] as $metric) {
            if ($metric['label'] === $label) {
                return $metric['value'];
            }
        }

        return null;
    }

    /* ── access ────────────────────────────────────────────────────── */

    public function test_reporting_is_closed_to_employees_and_clients(): void
    {
        foreach (['Employee', 'Client'] as $type) {
            $user = $this->user($type, mb_strtolower($type).'@example.com');

            $this->actingAs($user)->getJson('/admin/reports')->assertForbidden();
            $this->actingAs($user)->postJson('/admin/reports', ['type' => 'usage', 'range' => 'last_7'])
                ->assertForbidden();
        }

        // And nothing was created on the way to being refused.
        $this->assertSame(0, Report::count());
    }

    /* ── the numbers are real ──────────────────────────────────────── */

    public function test_a_usage_report_counts_sign_ins_uploads_and_messages_from_real_rows(): void
    {
        $admin = $this->user();
        $colleague = $this->user('Employee', 'sam@example.com');

        $this->signIn($admin);
        $this->signIn($colleague);
        $this->signIn($colleague, '2 days');

        $this->file($admin, 1024);
        $this->file($colleague, 2048);

        $this->message($colleague);

        $report = $this->create($admin, ['type' => 'usage', 'range' => 'last_7']);

        $this->assertSame('ready', $report['status']);
        $this->assertSame('3', $this->metric($report, 'Sign-ins'));
        $this->assertSame('2 people', collect($report['data']['metrics'])->firstWhere('label', 'Sign-ins')['hint']);
        $this->assertSame('2', $this->metric($report, 'Files uploaded'));
        $this->assertSame('1', $this->metric($report, 'Messages sent'));

        // Busiest accounts is a real breakdown, most active first.
        $this->assertSame(['Account', 'Type', 'Actions'], $report['data']['table']['columns']);
        $this->assertSame($colleague->name, $report['data']['table']['rows'][0][0]);
    }

    public function test_the_date_window_excludes_activity_outside_it(): void
    {
        $admin = $this->user();

        $this->signIn($admin);                 // today — inside
        $this->signIn($admin, '3 days');       // inside a 7-day window
        $this->signIn($admin, '40 days');      // outside it

        $week = $this->create($admin, ['type' => 'usage', 'range' => 'last_7']);
        $quarter = $this->create($admin, ['type' => 'usage', 'range' => 'last_90']);

        $this->assertSame('2', $this->metric($week, 'Sign-ins'));
        $this->assertSame('3', $this->metric($quarter, 'Sign-ins'));
    }

    public function test_a_storage_report_measures_bytes_on_hand_and_what_the_window_added(): void
    {
        $admin = $this->user();

        $this->file($admin, 1_048_576);              // 1 MB, today
        $this->file($admin, 2 * 1_048_576, '2 days'); // 2 MB, inside the window
        $this->file($admin, 5 * 1_048_576, '60 days'); // 5 MB, older than the window

        $report = $this->create($admin, ['type' => 'storage', 'range' => 'last_7']);

        // Storage used is a level: everything still on disk, whenever it landed.
        $this->assertSame('8.0 MB', $this->metric($report, 'Storage used'));
        // Added is a flow, and the 60-day-old file is outside the window.
        $this->assertSame('3.0 MB', $this->metric($report, 'Added in period'));
        $this->assertSame([$admin->name, '3', '8.0 MB'], $report['data']['table']['rows'][0]);
    }

    public function test_a_custom_window_uses_the_dates_it_was_given(): void
    {
        $admin = $this->user();

        $this->signIn($admin, '10 days');
        $this->signIn($admin, '2 days');

        $report = $this->create($admin, [
            'type' => 'usage',
            'range' => 'custom',
            'startsOn' => now()->subDays(12)->toDateString(),
            'endsOn' => now()->subDays(8)->toDateString(),
        ]);

        $this->assertSame('1', $this->metric($report, 'Sign-ins'));
        $this->assertSame(now()->subDays(12)->toDateString(), $report['data']['window']['from']);
        $this->assertSame(now()->subDays(8)->toDateString(), $report['data']['window']['to']);
    }

    /* ── the report survives ───────────────────────────────────────── */

    public function test_a_report_keeps_its_numbers_and_can_be_reopened(): void
    {
        $admin = $this->user();
        $this->signIn($admin);

        $created = $this->create($admin, ['type' => 'usage', 'range' => 'last_7']);

        // More activity after the fact must not silently change what the
        // report said — a stored report is a record, not a live query.
        $this->signIn($admin);
        $this->signIn($admin);

        $reopened = $this->actingAs($admin)->getJson('/admin/reports/'.$created['id'])
            ->assertOk()->json('report');

        $this->assertSame('1', $this->metric($reopened, 'Sign-ins'));

        // Re-running it deliberately re-measures.
        $rerun = $this->actingAs($admin)->postJson('/admin/reports/'.$created['id'].'/run')
            ->assertOk()->json('report');

        $this->assertSame('3', $this->metric($rerun, 'Sign-ins'));
    }

    public function test_reports_are_listed_by_tab_and_can_be_deleted(): void
    {
        $admin = $this->user();

        $oneOff = $this->create($admin, ['type' => 'access', 'range' => 'last_7']);
        $repeating = $this->create($admin, ['type' => 'messaging', 'range' => 'last_30', 'recurring' => true, 'frequency' => 'monthly']);

        $index = $this->actingAs($admin)->getJson('/admin/reports')->assertOk()->json();

        $this->assertSame([$oneOff['id']], collect($index['recent'])->pluck('id')->all());
        $this->assertSame([$repeating['id']], collect($index['recurring'])->pluck('id')->all());
        $this->assertSame('monthly', $index['recurring'][0]['frequency']);

        $this->actingAs($admin)->deleteJson('/admin/reports/'.$oneOff['id'])->assertOk();
        $this->assertNull(Report::where('uid', $oneOff['id'])->first());
    }

    public function test_a_report_exports_its_numbers_as_csv(): void
    {
        $admin = $this->user();
        $this->signIn($admin);

        $report = $this->create($admin, ['type' => 'usage', 'range' => 'last_7']);

        $response = $this->actingAs($admin)->get('/admin/reports/'.$report['id'].'/export')->assertOk();

        $csv = $response->streamedContent();

        $this->assertStringContainsString('Sign-ins', $csv);
        $this->assertStringContainsString('Busiest accounts', $csv);
        $this->assertStringContainsString($admin->name, $csv);
    }

    /* ── recurring ─────────────────────────────────────────────────── */

    public function test_a_recurring_report_is_scheduled_and_rolls_its_window_forward(): void
    {
        $admin = $this->user();

        $created = $this->create($admin, [
            'type' => 'usage', 'range' => 'last_7', 'recurring' => true, 'frequency' => 'weekly',
        ]);

        $report = Report::where('uid', $created['id'])->firstOrFail();
        $this->assertNotNull($report->next_run_at);
        $this->assertTrue($report->next_run_at->isAfter(now()->addDays(6)));

        // Wind the window back so the roll is observable, then run the tick.
        $report->forceFill([
            'starts_on' => now()->subDays(20)->toDateString(),
            'ends_on' => now()->subDays(14)->toDateString(),
            'next_run_at' => now()->subHour(),
        ])->save();

        $this->signIn($admin);

        $this->artisan('reports:run')->assertSuccessful();

        $report->refresh();
        $this->assertSame(now()->toDateString(), $report->ends_on->toDateString());
        $this->assertSame(now()->subDays(6)->toDateString(), $report->starts_on->toDateString());
        $this->assertSame('1', collect($report->data['metrics'])->firstWhere('label', 'Sign-ins')['value']);
        $this->assertTrue($report->next_run_at->isFuture());
    }

    public function test_the_tick_leaves_one_off_reports_alone(): void
    {
        $admin = $this->user();
        $created = $this->create($admin, ['type' => 'usage', 'range' => 'last_7']);

        $report = Report::where('uid', $created['id'])->firstOrFail();
        $before = $report->generated_at;

        $this->travel(1)->hours();
        $this->artisan('reports:run')->assertSuccessful();

        $this->assertEquals($before, $report->refresh()->generated_at);
    }

    /* ── failure ───────────────────────────────────────────────────── */

    public function test_a_report_that_cannot_be_built_keeps_the_row_and_the_reason(): void
    {
        $admin = $this->user();
        $report = Report::create([
            'name' => 'Broken report',
            'type' => 'usage',
            'range_key' => 'last_7',
            'starts_on' => now()->subDays(6)->toDateString(),
            'ends_on' => now()->toDateString(),
            'created_by' => $admin->id,
        ]);

        // Take the table the builder reads out from under it.
        DB::statement('DROP TABLE activity_logs');

        ReportRunner::run($report);

        $this->assertSame('failed', $report->refresh()->status);
        $this->assertNotNull($report->error);
    }
}
