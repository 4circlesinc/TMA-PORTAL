<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\ConnectedAccount;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\MailMessage;
use App\Models\Message;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\Status as CipStatus;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The portal home KPI row.
 *
 * The response-time cards are the ones worth pinning: they merge two channels
 * and they measure a gap between two rows, so the failure modes are all about
 * *which* pair gets measured — a follow-up nudge restarting the clock, staff
 * chatter counting as a client wait, or an internal thread leaking in.
 */
class DashboardMetricsTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $email = 'staff@example.com', string $type = 'Administrator'): User
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

    /** A client with both doors open: a portal login and a directory record. */
    private function client(string $email = 'dana@example.com'): User
    {
        $user = User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        Client::create([
            'uid' => Str::slug($user->name).'-'.$user->id,
            'user_id' => $user->id,
            'name' => $user->name,
            'email' => $email,
            'data' => [],
        ]);

        return $user;
    }

    private function conversation(User ...$members): Conversation
    {
        $c = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);

        foreach ($members as $m) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $m->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    /** created_at is not fillable, so it is backdated after the insert. */
    private function say(Conversation $c, User $sender, string $ago): Message
    {
        $m = Message::create([
            'conversation_id' => $c->id,
            'user_id' => $sender->id,
            'type' => Message::TYPE_TEXT,
            'body' => 'x',
        ]);

        $m->forceFill(['created_at' => now()->sub($ago)])->saveQuietly();

        return $m;
    }

    private function mailbox(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => $user->email,
            'name' => $user->name,
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);
    }

    private function mail(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(8),
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_email' => 'dana@example.com',
            'sent_at' => now()->subHours(4),
        ], $overrides));
    }

    private function metrics(User $as, ?string $period = null): array
    {
        $url = '/portal/dashboard/metrics'.($period === null ? '' : '?period='.$period);

        return $this->actingAs($as)->getJson($url)->assertOk()->json();
    }

    /* ── response time ─────────────────────────────────────────────── */

    public function test_it_measures_the_gap_between_a_client_message_and_the_staff_reply(): void
    {
        $staff = $this->staff();
        $client = $this->client();
        $c = $this->conversation($staff, $client);

        $this->say($c, $client, '5 hours');
        $this->say($c, $staff, '3 hours');   // answered after 2h

        $card = $this->metrics($staff)['cards']['clientResponse'];

        $this->assertSame(7200, $card['seconds']);
        $this->assertSame('2h', $card['value']);
        $this->assertSame(1, $card['sample']);
    }

    public function test_follow_up_nudges_do_not_restart_the_clock(): void
    {
        $staff = $this->staff();
        $client = $this->client();
        $c = $this->conversation($staff, $client);

        $this->say($c, $client, '5 hours');
        $this->say($c, $client, '4 hours');   // "any update?"
        $this->say($c, $staff, '3 hours');

        $card = $this->metrics($staff)['cards']['clientResponse'];

        // One wait of 2h, measured from the first ask — not a 1h reply.
        $this->assertSame(7200, $card['seconds']);
        $this->assertSame(1, $card['sample']);
    }

    public function test_internal_staff_threads_are_not_client_response_times(): void
    {
        $staff = $this->staff();
        $colleague = $this->staff('other@example.com', 'Reviewing Officer');
        $c = $this->conversation($staff, $colleague);

        $this->say($c, $colleague, '5 hours');
        $this->say($c, $staff, '1 hour');

        $card = $this->metrics($staff)['cards']['clientResponse'];

        $this->assertSame('-', $card['value']);
        $this->assertSame(0, $card['sample']);
    }

    public function test_it_measures_email_replies_to_clients_too(): void
    {
        $staff = $this->staff();
        $this->client();
        $account = $this->mailbox($staff);

        $this->mail($staff, $account, ['sent_at' => now()->subHours(6)]);
        $this->mail($staff, $account, [
            'folder' => 'sent',
            'from_email' => $staff->email,
            'sent_at' => now()->subHours(5),
        ]);

        $card = $this->metrics($staff)['cards']['clientResponse'];

        $this->assertSame(3600, $card['seconds']);
        $this->assertSame(1, $card['sample']);
    }

    public function test_outbound_mail_with_no_client_message_before_it_is_not_a_response(): void
    {
        $staff = $this->staff();
        $this->client();
        $account = $this->mailbox($staff);

        // Staff wrote first; the client's reply is still unanswered.
        $this->mail($staff, $account, [
            'folder' => 'sent',
            'from_email' => $staff->email,
            'sent_at' => now()->subHours(6),
        ]);
        $this->mail($staff, $account, ['sent_at' => now()->subHours(5)]);

        $card = $this->metrics($staff)['cards']['clientResponse'];

        $this->assertSame(0, $card['sample']);
    }

    /* ── CIP updates required ──────────────────────────────────────── */

    public function test_it_counts_cip_applications_waiting_on_updates(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $waiting = Applications::create($provider, $staff);
        $waiting->forceFill(['status' => CipStatus::UPDATE_REQUIRED])->save();
        CipEvent::create([
            'application_id' => $waiting->id,
            'actor_id' => $staff->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => CipStatus::ASSESSMENT_FEEDBACK,
            'to_status' => CipStatus::UPDATE_REQUIRED,
        ])->forceFill(['created_at' => now()->subHours(3)])->saveQuietly();

        $clear = Applications::create($provider, $staff);
        $clear->forceFill(['status' => CipStatus::REVIEW_APPLICATION])->save();

        $card = $this->metrics($staff)['cards']['cipUpdatesRequired'];

        $this->assertSame('1', $card['value']);
        $this->assertStringContainsString('3h', $card['delta']);
    }

    /* ── new CIP applications ──────────────────────────────────────── */

    public function test_new_cip_applications_count_the_window(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $recent = Applications::create($provider, $staff);
        $recent->forceFill(['created_at' => now()->subDays(2)])->saveQuietly();

        $alsoRecent = Applications::create($provider, $staff);
        $alsoRecent->forceFill(['created_at' => now()->subDays(9)])->saveQuietly();

        $old = Applications::create($provider, $staff);
        $old->forceFill(['created_at' => now()->subDays(45)])->saveQuietly();

        $card = $this->metrics($staff)['cards']['cipNew'];

        $this->assertSame(2, $card['count']);
    }

    /* ── the date-range picker ─────────────────────────────────────── */

    /** A CIP application backdated to an instant, given in UTC. */
    private function filedAt(CipProvider $provider, User $by, string $at): void
    {
        Applications::create($provider, $by)
            ->forceFill(['created_at' => CarbonImmutable::parse($at, 'UTC')])
            ->saveQuietly();
    }

    public function test_the_period_picker_measures_calendar_windows(): void
    {
        config(['services.cip.enabled' => true]);
        // A Wednesday, so "today", "this week" (from Monday) and "this month"
        // all draw different lines.
        $this->travelTo(CarbonImmutable::parse('2026-08-26 12:00:00', 'UTC'));
        $staff = $this->staff();
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $this->filedAt($provider, $staff, '2026-08-26 08:00:00'); // today
        $this->filedAt($provider, $staff, '2026-08-24 09:00:00'); // Monday: this week
        $this->filedAt($provider, $staff, '2026-08-20 09:00:00'); // last week: this month
        $this->filedAt($provider, $staff, '2026-07-30 09:00:00'); // last month: this year
        $this->filedAt($provider, $staff, '2025-12-31 09:00:00'); // last year

        $this->assertSame(1, $this->metrics($staff, 'today')['cards']['cipNew']['count']);
        $this->assertSame(2, $this->metrics($staff, 'week')['cards']['cipNew']['count']);
        $this->assertSame(3, $this->metrics($staff, 'month')['cards']['cipNew']['count']);
        $this->assertSame(4, $this->metrics($staff, 'year')['cards']['cipNew']['count']);

        $week = $this->metrics($staff, 'week');
        $this->assertSame('week', $week['period']);
        $this->assertSame('New CIP applications filed this week.', $week['cards']['cipNew']['hint']);
    }

    public function test_the_comparison_is_the_same_stretch_of_the_previous_period(): void
    {
        config(['services.cip.enabled' => true]);
        // Wednesday noon: this week so far is Monday to Wednesday noon, so it
        // is read against last Monday to last Wednesday noon, not all seven
        // days of last week.
        $this->travelTo(CarbonImmutable::parse('2026-08-26 12:00:00', 'UTC'));
        $staff = $this->staff();
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $this->filedAt($provider, $staff, '2026-08-25 09:00:00'); // this week
        $this->filedAt($provider, $staff, '2026-08-18 09:00:00'); // last Tuesday: in the comparison
        $this->filedAt($provider, $staff, '2026-08-21 09:00:00'); // last Friday: after it

        $card = $this->metrics($staff, 'week')['cards']['cipNew'];

        $this->assertSame(1, $card['count']);
        $this->assertSame('No change', $card['delta']);
    }

    public function test_this_week_on_sunday_morning_still_counts_weekday_filings(): void
    {
        config(['services.cip.enabled' => true]);
        // Sunday 01:02 in St Lucia. A Sunday-start week would have begun an
        // hour earlier and dropped Friday's filing from "This week".
        $this->travelTo(CarbonImmutable::parse('2026-09-06 05:02:00', 'UTC'));
        $staff = $this->staff();
        $staff->forceFill(['preferences' => ['timezone' => 'America/St_Lucia']])->save();
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $this->filedAt($provider, $staff, '2026-08-31 17:58:00'); // Monday afternoon
        $this->filedAt($provider, $staff, '2026-09-02 14:16:00'); // Wednesday
        $this->filedAt($provider, $staff, '2026-08-30 12:00:00'); // previous Sunday: last week

        $this->assertSame(2, $this->metrics($staff, 'week')['cards']['cipNew']['count']);
    }

    public function test_today_ends_at_the_reader_midnight_not_the_server_one(): void
    {
        config(['services.cip.enabled' => true]);
        // 15:00 UTC is 03:00 the next morning in Auckland.
        $this->travelTo(CarbonImmutable::parse('2026-08-26 15:00:00', 'UTC'));
        $auckland = $this->staff('nz@example.com');
        $auckland->forceFill(['preferences' => ['timezone' => 'Pacific/Auckland']])->save();
        $utc = $this->staff('utc@example.com');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);

        $this->filedAt($provider, $utc, '2026-08-26 10:00:00'); // 22:00 yesterday in Auckland
        $this->filedAt($provider, $utc, '2026-08-26 14:00:00'); // 02:00 today in both

        $this->assertSame(1, $this->metrics($auckland, 'today')['cards']['cipNew']['count']);
        $this->assertSame(2, $this->metrics($utc, 'today')['cards']['cipNew']['count']);
    }

    public function test_an_unknown_period_falls_back_to_the_rolling_window(): void
    {
        $json = $this->metrics($this->staff(), 'fortnight');

        $this->assertSame('rolling', $json['period']);
        $this->assertSame(30, $json['windowDays']);
    }

    /* ── documents awaiting signature ──────────────────────────────── */

    private function request(User $by, string $status, array $overrides = []): SignatureRequest
    {
        return SignatureRequest::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'created_by' => $by->id,
            'title' => 'Engagement letter',
            'status' => $status,
            'sent_at' => $status === 'draft' ? null : now()->subDays(2),
        ], $overrides));
    }

    public function test_it_counts_documents_that_are_out_and_still_unsigned(): void
    {
        $staff = $this->staff();

        $this->request($staff, 'sent');
        $this->request($staff, 'viewed');
        $this->request($staff, 'in_progress');
        $this->request($staff, 'draft');        // never went out
        $this->request($staff, 'completed');    // already signed
        $this->request($staff, 'declined');
        $this->request($staff, 'cancelled');

        $card = $this->metrics($staff)['cards']['awaitingSignature'];

        $this->assertSame('3', $card['value']);
        $this->assertSame('3 documents are out for signature and unsigned.', $card['hint']);
    }

    public function test_the_delta_reports_how_long_the_oldest_one_has_been_out(): void
    {
        $staff = $this->staff();

        $this->request($staff, 'sent', ['sent_at' => now()->subDays(6)]);
        $this->request($staff, 'sent', ['sent_at' => now()->subHours(2)]);

        $card = $this->metrics($staff)['cards']['awaitingSignature'];

        $this->assertSame(2, $card['count']);
        $this->assertSame('6d waiting', $card['delta']);
    }

    public function test_an_expired_request_is_no_longer_outstanding(): void
    {
        $staff = $this->staff();

        $this->request($staff, 'sent', ['expires_at' => now()->subDay()]);
        $this->request($staff, 'sent', ['expires_at' => now()->addWeek()]);

        // The lapsed one needs re-sending, not chasing.
        $this->assertSame(1, $this->metrics($staff)['cards']['awaitingSignature']['count']);
    }

    public function test_nothing_outstanding_reads_as_all_signed(): void
    {
        $staff = $this->staff();
        $this->request($staff, 'completed');

        $card = $this->metrics($staff)['cards']['awaitingSignature'];

        $this->assertSame('0', $card['value']);
        $this->assertSame('All signed', $card['delta']);
        $this->assertTrue($card['deltaUp']);
    }

    /* ── scope ─────────────────────────────────────────────────────── */

    public function test_a_non_admin_staff_member_sees_their_own_numbers_and_an_admin_sees_the_firm(): void
    {
        $admin = $this->staff('admin@example.com');
        $officer = $this->staff('officer@example.com', 'Reviewing Officer');

        $this->request($admin, 'sent');
        $this->request($officer, 'sent');

        $this->assertSame('organization', $this->metrics($admin)['scope']);
        $this->assertSame(2, $this->metrics($admin)['cards']['awaitingSignature']['count']);

        $this->assertSame('personal', $this->metrics($officer)['scope']);
        $this->assertSame(1, $this->metrics($officer)['cards']['awaitingSignature']['count']);
    }

    public function test_clients_get_no_kpi_row(): void
    {
        $response = $this->actingAs($this->client())->getJson('/portal/dashboard/metrics')->assertOk();

        $response->assertJson(['staff' => false]);
        $this->assertArrayNotHasKey('cards', $response->json());
    }

    public function test_a_provider_contact_gets_cip_and_inbox_cards(): void
    {
        config(['services.cip.enabled' => true]);

        $staff = $this->staff();
        $gil = User::factory()->create([
            'email' => 'gil@galaxy.example',
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $company = Company::create(['uid' => 'galaxy-firm', 'name' => 'Galaxy Firm']);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $gil->id,
            'name' => $gil->name,
            'email' => $gil->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $provider = CipProvider::create([
            'name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id,
        ]);

        Applications::create($provider, $staff);
        $needsUpdate = Applications::create($provider, $staff);
        $needsUpdate->forceFill(['status' => CipStatus::UPDATE_REQUIRED])->save();
        $granted = Applications::create($provider, $staff);
        $granted->forceFill(['status' => CipStatus::GRANTED])->save();

        $person = CipPerson::create([
            'application_id' => $needsUpdate->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        $slot = CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $needsUpdate->id,
            'person_id' => $person->id,
            'type' => 'police_certificate',
            'label' => 'Police certificate',
            'required' => true,
        ]);
        DocumentComments::create($slot, $staff, 'This scan is cut off at the bottom.');

        $thread = $this->conversation($staff, $gil);
        $this->say($thread, $staff, '1 hour');

        $payload = $this->metrics($gil);

        $this->assertTrue($payload['provider']);
        $this->assertFalse($payload['staff']);
        $this->assertSame('provider', $payload['scope']);
        $this->assertSame(2, $payload['cards']['cipActive']['count']);
        $this->assertSame(1, $payload['cards']['cipUpdatesRequired']['count']);
        $this->assertSame(1, $payload['cards']['unreadMessages']['count']);
        $this->assertSame(1, $payload['cards']['openComments']['count']);
        $this->assertArrayNotHasKey('clientResponse', $payload['cards']);
    }

    public function test_an_empty_account_reports_nothing_rather_than_inventing_a_number(): void
    {
        config(['services.cip.enabled' => true]);
        $cards = $this->metrics($this->staff())['cards'];

        $this->assertSame('-', $cards['clientResponse']['value']);
        $this->assertSame('0', $cards['cipNew']['value']);
        $this->assertSame('0', $cards['cipUpdatesRequired']['value']);
    }
}
