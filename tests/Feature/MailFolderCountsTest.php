<?php

namespace Tests\Feature;

use App\Http\Controllers\MailController;
use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\Mailbox;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use ReflectionMethod;
use Tests\TestCase;

/**
 * The sidebar badge counts.
 *
 * These used to be five aggregations over the mailbox per call, and the
 * email page asks for them every 30 seconds per signed-in person. They are
 * now one pass. The numbers must not have moved, so the five-pass original
 * is kept here verbatim as an oracle and the two are compared on data that
 * reaches every branch.
 */
class MailFolderCountsTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function account(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user'.$user->id.'@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(10),
            'thread_id' => 'thread-'.Str::random(6),
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    private function counts(int $userId): array
    {
        $method = new ReflectionMethod(MailController::class, 'folderCounts');
        $method->setAccessible(true);

        return $method->invoke(app(MailController::class), $userId);
    }

    /**
     * The five-pass original, kept exactly as it was before the rewrite.
     *
     * @return array<string, array{total: int, unread: int}>
     */
    private function fivePassOriginal(int $userId): array
    {
        $columns = [
            'important' => 'is_important',
            'starred' => 'is_starred',
            'pinned' => 'is_pinned',
        ];

        $rows = MailMessage::query()
            ->selectRaw('folder, count(*) as total, sum(case when is_read then 0 else 1 end) as unread')
            ->where('user_id', $userId)
            ->whereNull('snoozed_until')
            ->groupBy('folder')
            ->get()
            ->keyBy('folder');

        $counts = [];

        foreach (Mailbox::FOLDERS as $folder) {
            $row = $rows->get($folder);
            $counts[$folder] = [
                'total' => (int) ($row->total ?? 0),
                'unread' => (int) ($row->unread ?? 0),
            ];
        }

        foreach ($columns as $view => $column) {
            $row = MailMessage::query()
                ->selectRaw('count(*) as total, sum(case when is_read then 0 else 1 end) as unread')
                ->where('user_id', $userId)
                ->where($column, true)
                ->whereNotIn('folder', ['trash', 'spam', 'draft'])
                ->whereNull('snoozed_until')
                ->first();

            $counts[$view] = [
                'total' => (int) ($row->total ?? 0),
                'unread' => (int) ($row->unread ?? 0),
            ];
        }

        $snoozed = MailMessage::query()
            ->selectRaw('count(*) as total, sum(case when is_read then 0 else 1 end) as unread')
            ->where('user_id', $userId)
            ->whereNotNull('snoozed_until')
            ->first();

        $counts['snoozed'] = [
            'total' => (int) ($snoozed->total ?? 0),
            'unread' => (int) ($snoozed->unread ?? 0),
        ];

        return $counts;
    }

    public function test_one_pass_counts_match_the_five_pass_original(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        // Every folder crossed with read/unread, snoozed/not, and each flag
        // on and off, so no branch of the conditional sums goes untouched.
        $i = 0;
        foreach (Mailbox::FOLDERS as $folder) {
            foreach ([true, false] as $read) {
                foreach ([null, now()->addDay()] as $snoozed) {
                    $this->message($user, $account, [
                        'folder' => $folder,
                        'is_read' => $read,
                        'is_important' => $i % 2 === 0,
                        'is_starred' => $i % 3 === 0,
                        'is_pinned' => $i % 4 === 0,
                        'snoozed_until' => $snoozed,
                    ]);
                    $i++;
                }
            }
        }

        // A second person's mailbox must not leak into the first's badges.
        $other = $this->user();
        $otherAccount = $this->account($other);
        foreach (['inbox', 'trash', 'archive'] as $folder) {
            $this->message($other, $otherAccount, [
                'folder' => $folder,
                'is_important' => true,
                'is_starred' => true,
                'is_pinned' => true,
            ]);
        }

        $this->assertSame($this->fivePassOriginal($user->id), $this->counts($user->id));
    }

    public function test_an_empty_mailbox_counts_zero_everywhere(): void
    {
        $user = $this->user();

        $counts = $this->counts($user->id);

        $this->assertSame($this->fivePassOriginal($user->id), $counts);

        foreach ($counts as $view => $pair) {
            $this->assertSame(['total' => 0, 'unread' => 0], $pair, $view.' should be empty');
        }
    }

    public function test_snoozed_mail_is_hidden_from_its_folder_and_from_the_flag_views(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, [
            'folder' => 'inbox',
            'is_read' => false,
            'is_important' => true,
            'is_starred' => true,
            'is_pinned' => true,
            'snoozed_until' => now()->addDay(),
        ]);

        $counts = $this->counts($user->id);

        $this->assertSame(['total' => 0, 'unread' => 0], $counts['inbox']);
        $this->assertSame(['total' => 0, 'unread' => 0], $counts['important']);
        $this->assertSame(['total' => 0, 'unread' => 0], $counts['starred']);
        $this->assertSame(['total' => 0, 'unread' => 0], $counts['pinned']);
        $this->assertSame(['total' => 1, 'unread' => 1], $counts['snoozed']);
    }

    public function test_flag_views_span_folders_but_skip_trash_spam_and_drafts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        foreach (['inbox', 'archive', 'sent'] as $folder) {
            $this->message($user, $account, ['folder' => $folder, 'is_starred' => true, 'is_read' => false]);
        }

        foreach (['trash', 'spam', 'draft'] as $folder) {
            $this->message($user, $account, ['folder' => $folder, 'is_starred' => true, 'is_read' => false]);
        }

        $counts = $this->counts($user->id);

        $this->assertSame(['total' => 3, 'unread' => 3], $counts['starred']);
        $this->assertSame($this->fivePassOriginal($user->id), $counts);
    }

    public function test_the_badges_are_answered_in_a_single_query(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        foreach (Mailbox::FOLDERS as $folder) {
            $this->message($user, $account, ['folder' => $folder, 'is_starred' => true]);
        }

        DB::enableQueryLog();
        $this->counts($user->id);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertCount(1, $queries, 'Folder counts should cost one pass over the mailbox, not five.');
    }
}
