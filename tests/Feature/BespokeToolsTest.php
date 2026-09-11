<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CipProvider;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Bespoke\Bespoke;
use App\Support\Bespoke\Page;
use App\Support\Bespoke\Prompt;
use App\Support\Bespoke\Toolbox;
use App\Support\Cip\Applications;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The model may only act through the toolbox, and the toolbox only sees
 * what the reader's own account could open. Tools draft; the reader sends.
 */
class BespokeToolsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'gsk_test',
            'services.bespoke.base_url' => 'https://api.groq.com/openai/v1',
            'services.bespoke.model' => 'openai/gpt-oss-120b',
            'services.cip.enabled' => true,
        ]);
    }

    private function user(string $accountType, array $extra = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $extra));
    }

    private function toolbox(User $user, string $path = '/'): Toolbox
    {
        return new Toolbox($user, Bespoke::identity($user), Page::fromClient(['path' => $path]));
    }

    /** @param  list<array<string, mixed>>  $calls */
    private function toolCallResponse(array $calls): array
    {
        return [
            'choices' => [[
                'finish_reason' => 'tool_calls',
                'message' => [
                    'role' => 'assistant',
                    'content' => null,
                    'tool_calls' => array_map(fn (array $c, int $i) => [
                        'id' => 'call_'.$i,
                        'type' => 'function',
                        'function' => ['name' => $c['name'], 'arguments' => json_encode($c['args'])],
                    ], $calls, array_keys($calls)),
                ],
            ]],
        ];
    }

    private function textResponse(string $text): array
    {
        return ['choices' => [['finish_reason' => 'stop', 'message' => ['role' => 'assistant', 'content' => $text]]]];
    }

    // ---------------------------------------------------------- the loop

    public function test_the_model_can_look_someone_up_then_draft_a_message_and_the_reader_gets_send_buttons(): void
    {
        $vernon = $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => 'IT & Web Solutions Specialist']);
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Olivia Officer']);

        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push($this->toolCallResponse([['name' => 'lookup_people', 'args' => ['query' => 'IT']]]))
                ->push($this->toolCallResponse([['name' => 'propose_message', 'args' => ['userId' => $vernon->id, 'body' => 'Hi Vernon, I cannot open the File Library.']]]))
                ->push($this->textResponse('Here is a draft to Vernon Francis (IT & Web Solutions Specialist). Does it read right? Send is below.')),
        ]);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'message the IT person that I cannot open the File Library']],
                'clientContext' => ['path' => '/'],
            ])
            ->assertOk()
            ->json();

        $this->assertSame('model', $payload['source']);
        $this->assertCount(1, $payload['actions']);
        $action = $payload['actions'][0];
        $this->assertSame('message', $action['type']);
        $this->assertSame($vernon->id, $action['to']['userId']);
        $this->assertSame('IT & Web Solutions Specialist', $action['to']['jobTitle']);
        $this->assertStringContainsString('File Library', $action['body']);
        $this->assertSame([], $payload['choices']);

        Http::assertSentCount(3);
        // The second request carries the tool result back under its call id.
        Http::assertSent(function ($request) use ($vernon) {
            $messages = $request->data()['messages'] ?? [];
            $tool = collect($messages)->firstWhere('role', 'tool');

            return $tool
                && $tool['tool_call_id'] === 'call_0'
                && str_contains($tool['content'], 'Vernon Francis')
                && str_contains($tool['content'], (string) $vernon->id)
                && ! empty($request->data()['tools']);
        });
    }

    public function test_offer_choices_becomes_reply_buttons(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push($this->toolCallResponse([['name' => 'offer_choices', 'args' => ['options' => ['Yes, draft it', 'No', 'Yes, draft it', '', 'Maybe later', 'Ask someone else', 'Fifth is dropped']]]]))
                ->push($this->textResponse('Shall I draft that?')),
        ]);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', ['messages' => [['role' => 'user', 'content' => 'help me write to someone']]])
            ->assertOk()
            ->json();

        $this->assertSame(['Yes, draft it', 'No', 'Maybe later', 'Ask someone else'], $payload['choices']);
        $this->assertSame('Shall I draft that?', $payload['reply']);
    }

    public function test_a_model_that_never_stops_calling_tools_is_asked_for_a_plain_answer(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $loop = $this->toolCallResponse([['name' => 'lookup_guide', 'args' => ['query' => 'two-factor']]]);
        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push($loop)->push($loop)->push($loop)->push($loop)->push($loop)
                ->push($this->textResponse('Settings → Account Security → Two-factor authentication.')),
        ]);

        $payload = $this->actingAs($officer)
            ->postJson('/portal/bespoke/chat', ['messages' => [['role' => 'user', 'content' => 'How do I turn on 2FA?']]])
            ->assertOk()
            ->json();

        $this->assertSame('model', $payload['source']);
        $this->assertStringContainsString('Two-factor', $payload['reply']);
        Http::assertSentCount(6);
        // The last request offers no tools at all.
        Http::assertSent(fn ($request) => ! array_key_exists('tools', $request->data())
            && count(array_filter($request->data()['messages'], fn ($m) => $m['role'] === 'tool')) === 5);
    }

    // ------------------------------------------------------------- people

    public function test_a_client_only_finds_their_team_and_the_administrators(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);
        $mine = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Olivia Officer', 'job_title' => 'Reviewing Officer']);
        $other = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Oscar Other']);
        $client = $this->user(Role::CLIENT, ['name' => 'Cara Client']);
        $record = Client::create(['uid' => 'cara', 'name' => 'Cara Client', 'user_id' => $client->id, 'email' => $client->email, 'data' => []]);
        ClientAssignment::create(['client_id' => $record->id, 'user_id' => $mine->id, 'role' => 'lead', 'status' => ClientAssignment::STATUS_ACTIVE, 'assigned_by' => $admin->id]);

        $box = $this->toolbox($client);
        $names = array_column($box->call('lookup_people', ['query' => 'o'])['people'], 'name');
        $this->assertContains('Olivia Officer', $names);
        $this->assertNotContains('Oscar Other', $names);

        $admins = array_column($box->call('lookup_people', ['query' => 'administrator'])['people'], 'name');
        $this->assertSame(['Ada Admin'], $admins);

        // Drafting to someone outside the team is refused, not queued.
        $refused = $box->call('propose_message', ['userId' => $other->id, 'body' => 'hello']);
        $this->assertArrayHasKey('error', $refused);
        $this->assertSame([], $box->actions());

        $ok = $box->call('propose_message', ['userId' => $mine->id, 'body' => 'hello']);
        $this->assertTrue($ok['ok']);
        $this->assertSame($mine->id, $box->actions()[0]['to']['userId']);
    }

    public function test_the_prompt_names_administrators_and_the_technical_contact_this_reader_can_reach(): void
    {
        $this->user(Role::ADMINISTRATOR, ['name' => 'Vernon Francis', 'job_title' => 'IT & Web Solutions Specialist']);
        $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);
        $client = $this->user(Role::CLIENT);

        $prompt = Prompt::system($client, Bespoke::identity($client), Page::fromClient(['path' => '/']), []);

        $this->assertStringContainsString('Administrators this reader can reach: Ada Admin, Vernon Francis', $prompt);
        $this->assertStringContainsString('Vernon Francis (IT & Web Solutions Specialist)', $prompt);
        $this->assertStringContainsString('That isn’t available for your account type.', $prompt);
        $this->assertStringContainsString('no Email in the portal', $prompt);
    }

    // -------------------------------------------------------------- email

    public function test_email_drafts_need_mail_access_and_valid_addresses(): void
    {
        $client = $this->user(Role::CLIENT);
        $box = $this->toolbox($client);
        $this->assertNotContains('propose_email', array_column(array_column($box->definitions(), 'function'), 'name'));
        $this->assertArrayHasKey('error', $box->call('propose_email', ['to' => 'a@b.com', 'subject' => 'x', 'body' => 'y']));

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $box = $this->toolbox($officer);
        $this->assertContains('propose_email', array_column(array_column($box->definitions(), 'function'), 'name'));
        $this->assertArrayHasKey('error', $box->call('propose_email', ['to' => 'not-an-address', 'subject' => 'x', 'body' => 'y']));

        $ok = $box->call('propose_email', ['to' => 'Jane <jane@example.com>, bob@example.com', 'cc' => '', 'subject' => 'Updates required', 'body' => "Hello\n\nPlease upload the outstanding documents."]);
        $this->assertTrue($ok['ok']);
        $action = $box->actions()[0];
        $this->assertSame('email', $action['type']);
        $this->assertSame(['jane@example.com', 'bob@example.com'], $action['to']);
        $this->assertSame('Updates required', $action['subject']);
    }

    // ------------------------------------------------------- applications

    public function test_applications_are_listed_through_the_readers_own_scope(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $provider = CipProvider::create(['name' => 'Galaxy Provider', 'code' => 'GAL', 'company_id' => $company->id]);
        $otherProvider = CipProvider::create(['name' => 'Blue Provider', 'code' => 'BLU', 'company_id' => Company::create(['uid' => 'blue', 'name' => 'Blue'])->id]);

        $contact = $this->user(Role::CLIENT, ['name' => 'Paula Provider']);
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id, 'name' => $contact->name,
            'email' => $contact->email, 'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $mine = Applications::create($provider, $contact);
        $theirsSameFirm = Applications::create($provider, $admin, [], Status::REVIEW_APPLICATION);
        $elsewhere = Applications::create($otherProvider, $admin);

        $box = $this->toolbox($contact);
        $recent = $box->call('list_applications', ['scope' => 'recent']);
        $numbers = array_column($recent['applications'], 'number');
        $this->assertSame(2, $recent['total']);
        $this->assertContains($mine->internal_number, $numbers);
        $this->assertContains($theirsSameFirm->internal_number, $numbers);
        $this->assertNotContains($elsewhere->internal_number, $numbers);
        $this->assertArrayNotHasKey('officer', $recent['applications'][0]);

        $started = $box->call('list_applications', ['scope' => 'mine']);
        $this->assertSame([$mine->internal_number], array_column($started['applications'], 'number'));
        $this->assertTrue($started['applications'][0]['startedByMe']);

        $byStatus = $box->call('list_applications', ['status' => 'Review Applications']);
        $this->assertSame([$theirsSameFirm->internal_number], array_column($byStatus['applications'], 'number'));

        $one = $box->call('get_application', ['number' => strtolower($mine->internal_number)]);
        $this->assertSame($mine->internal_number, $one['application']['number']);
        $this->assertSame('New Applications', $one['application']['status']);
        $this->assertStringContainsString('reviewing officer', strtolower($one['application']['statusMeaning']));

        $this->assertArrayHasKey('error', $box->call('get_application', ['number' => $elsewhere->internal_number]));
    }

    public function test_a_plain_client_without_cip_reach_has_no_application_tools(): void
    {
        $client = $this->user(Role::CLIENT);
        $box = $this->toolbox($client);
        $names = array_column(array_column($box->definitions(), 'function'), 'name');
        $this->assertNotContains('list_applications', $names);
        $this->assertSame('CIP Applications are not available for this account type.', $box->call('list_applications', [])['error']);
    }

    // -------------------------------------------------------------- chips

    public function test_the_empty_chat_offers_the_new_abilities_only_when_the_model_is_live(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);

        $ids = fn (array $chips) => array_column($chips, 'id');

        $home = $this->actingAs($officer)->getJson('/portal/bespoke/suggestions?path=/')->assertOk()->json('chips');
        $this->assertContains('report-issue', $ids($home));
        $this->assertLessThanOrEqual(6, count($home));

        $intake = $this->actingAs($officer)->getJson('/portal/bespoke/suggestions?path=/citizenship-applications/new')->assertOk()->json('chips');
        $this->assertContains('photo-2x2', $ids($intake));

        config(['services.bespoke.key' => '']);
        $dark = $this->actingAs($officer)->getJson('/portal/bespoke/suggestions?path=/')->assertOk()->json('chips');
        $this->assertNotContains('report-issue', $ids($dark));
    }

    // -------------------------------------------------------------- guide

    public function test_the_guide_lookup_hides_staff_sections_from_clients(): void
    {
        $client = $this->user(Role::CLIENT);
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $admin = $this->user(Role::ADMINISTRATOR);

        $forClient = $this->toolbox($client)->call('lookup_guide', ['query' => 'How do I change my status to out of office?']);
        $this->assertNotEmpty($forClient['sections']);
        $this->assertSame('Your status', $forClient['sections'][0]['title']);

        $users = $this->toolbox($client)->call('lookup_guide', ['query' => 'Users and People directory']);
        $this->assertNotContains('Users and People', array_column($users['sections'], 'title'));

        // Users is an administration page: an officer does not get its section either.
        $officerView = $this->toolbox($officer)->call('lookup_guide', ['query' => 'Users and People directory']);
        $this->assertNotContains('Users and People', array_column($officerView['sections'], 'title'));

        $staff = $this->toolbox($admin)->call('lookup_guide', ['query' => 'Users and People directory']);
        $this->assertContains('Users and People', array_column($staff['sections'], 'title'));

        $faq = $this->toolbox($officer)->call('lookup_guide', ['query' => 'How do I turn on two-factor?']);
        $this->assertNotEmpty($faq['faq']);
    }
}
