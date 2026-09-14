<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\BespokeConversation;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Bespoke\Bespoke;
use App\Support\Bespoke\Page;
use App\Support\Bespoke\Prompt;
use App\Support\Bespoke\Toolbox;
use App\Support\Companies\CompanyMembers;
use App\Support\Companies\CompanyRoles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A Service Provider admin can invite a colleague from Bespoke. The model
 * drafts; the reader's Add click is what sends the invitation.
 */
class BespokeInviteProviderContactTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        config([
            'services.bespoke.enabled' => true,
            'services.bespoke.key' => 'gsk_test',
            'services.bespoke.base_url' => 'https://api.groq.com/openai/v1',
            'services.bespoke.model' => 'openai/gpt-oss-120b',
            'services.cip.enabled' => true,
        ]);
    }

    private function user(string $type, array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    /** @return array{0: Company, 1: CipProvider, 2: User, 3: User} */
    private function galaxyAdmin(): array
    {
        $tma = $this->user(Role::ADMINISTRATOR);
        $company = Company::create([
            'uid' => 'gal-firm',
            'name' => 'Galaxy',
            'status' => 'active',
        ]);
        $provider = CipProvider::create([
            'name' => 'Galaxy',
            'code' => 'GAL',
            'company_id' => $company->id,
        ]);
        $spAdmin = $this->user(Role::SERVICE_PROVIDER_ADMIN, [
            'email' => 'gil@galaxy.example',
            'name' => 'Gil Admin',
            'first_name' => 'Gil',
        ]);
        CompanyMembers::add($company, [
            'email' => $spAdmin->email,
            'name' => $spAdmin->name,
            'role' => CompanyRoles::MEMBER,
        ], $tma, notify: false);

        return [$company, $provider, $spAdmin, $tma];
    }

    private function toolbox(User $user): Toolbox
    {
        return new Toolbox($user, Bespoke::identity($user), Page::fromClient(['path' => '/']));
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

    public function test_the_prompt_tells_a_service_provider_admin_to_invite_at_their_firm(): void
    {
        [, , $spAdmin] = $this->galaxyAdmin();

        $prompt = Prompt::system($spAdmin, Bespoke::identity($spAdmin), Page::fromClient(['path' => '/']), []);

        $this->assertStringContainsString('Service Provider admin at Galaxy', $prompt);
        $this->assertStringContainsString('invite_provider_contact', $prompt);
        $this->assertStringContainsString('Do not say "That isn’t available for your account type."', $prompt);
        $this->assertStringContainsString('Do not send them to a TMA administrator for that', $prompt);
    }

    public function test_only_a_service_provider_admin_gets_the_invite_tool(): void
    {
        [, , $spAdmin, $tma] = $this->galaxyAdmin();
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $client = $this->user(Role::CLIENT);

        $names = fn (User $user) => array_column(array_column($this->toolbox($user)->definitions(), 'function'), 'name');

        $this->assertContains('invite_provider_contact', $names($spAdmin));
        $this->assertNotContains('invite_provider_contact', $names($tma));
        $this->assertNotContains('invite_provider_contact', $names($officer));
        $this->assertNotContains('invite_provider_contact', $names($client));
    }

    public function test_the_tool_drafts_an_invitation_card_and_does_not_send_it(): void
    {
        [$company, , $spAdmin] = $this->galaxyAdmin();
        $box = $this->toolbox($spAdmin);

        $ok = $box->call('invite_provider_contact', [
            'email' => 'djboy.vf@gmail.com',
            'name' => 'DJ Boy',
        ]);

        $this->assertTrue($ok['ok']);
        $this->assertSame('djboy.vf@gmail.com', $ok['email']);
        $this->assertSame('Galaxy', $ok['company']['name']);
        $this->assertFalse($ok['existingAccount']);
        $action = $box->actions()[0];
        $this->assertSame('invite-provider-contact', $action['type']);
        $this->assertSame('djboy.vf@gmail.com', $action['email']);
        $this->assertSame('DJ Boy', $action['name']);
        $this->assertSame('/citizenship-applications/companies/'.$company->uid, $action['url']);

        $this->assertSame(0, Invitation::query()->count());
        Mail::assertNothingSent();
    }

    public function test_staff_addresses_and_existing_members_are_refused(): void
    {
        [$company, , $spAdmin, $tma] = $this->galaxyAdmin();
        $officer = $this->user(Role::REVIEWING_OFFICER, ['email' => 'cro@tma.example']);
        $already = $this->user(Role::CLIENT, ['email' => 'dana@galaxy.example', 'name' => 'Dana Reed']);
        CompanyMembers::add($company, [
            'email' => $already->email,
            'name' => $already->name,
            'role' => CompanyRoles::MEMBER,
        ], $tma, notify: false);

        $box = $this->toolbox($spAdmin);

        $staff = $box->call('invite_provider_contact', ['email' => $officer->email]);
        $this->assertSame('That address belongs to a staff account. A Service Provider admin cannot add staff.', $staff['error']);

        $self = $box->call('invite_provider_contact', ['email' => $spAdmin->email]);
        $this->assertStringContainsString('cannot invite themselves', $self['error']);

        $dup = $box->call('invite_provider_contact', ['email' => $already->email]);
        $this->assertStringContainsString('already has portal access', $dup['error']);

        $this->assertSame([], $box->actions());
    }

    public function test_a_plain_client_cannot_invite_through_the_tool_or_the_button(): void
    {
        $client = $this->user(Role::CLIENT);
        $box = $this->toolbox($client);
        $this->assertArrayHasKey('error', $box->call('invite_provider_contact', ['email' => 'djboy.vf@gmail.com']));

        $this->actingAs($client)->postJson('/portal/bespoke/actions/invite-provider-contact', [
            'email' => 'djboy.vf@gmail.com',
        ])->assertStatus(422);
    }

    public function test_confirming_invites_a_new_address_and_notes_the_chat(): void
    {
        [$company, , $spAdmin] = $this->galaxyAdmin();
        $thread = BespokeConversation::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $spAdmin->id,
            'title' => 'Add DJ',
        ]);

        $payload = $this->actingAs($spAdmin)
            ->postJson('/portal/bespoke/actions/invite-provider-contact', [
                'email' => 'djboy.vf@gmail.com',
                'name' => 'DJ Boy',
                'conversationId' => $thread->uuid,
            ])
            ->assertOk()
            ->json();

        $this->assertTrue($payload['ok']);
        $this->assertTrue($payload['invited']);
        $this->assertFalse($payload['existingAccount']);
        $this->assertSame('djboy.vf@gmail.com', $payload['email']);
        $this->assertSame('/citizenship-applications/companies/'.$company->uid, $payload['url']);

        $this->assertTrue(
            CompanyMember::query()
                ->where('company_id', $company->id)
                ->whereRaw('LOWER(email) = ?', ['djboy.vf@gmail.com'])
                ->current()
                ->exists()
        );
        $this->assertSame('Client', Invitation::first()->role);

        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('djboy.vf@gmail.com')
                && str_contains(strtolower($mail->subjectLine), 'invited');
        });

        $note = $thread->messages()->latest('id')->firstOrFail();
        $this->assertSame('assistant', $note->role);
        $this->assertStringContainsString('djboy.vf@gmail.com', $note->body);
        $this->assertStringContainsString('Galaxy', $note->body);
    }

    public function test_confirming_adds_an_existing_account_as_a_contact(): void
    {
        [$company, , $spAdmin] = $this->galaxyAdmin();
        $person = $this->user(Role::CLIENT, [
            'email' => 'dana@galaxy.example',
            'name' => 'Dana Reed',
            'first_name' => 'Dana',
        ]);

        $this->actingAs($spAdmin)
            ->postJson('/portal/bespoke/actions/invite-provider-contact', [
                'email' => $person->email,
                'name' => 'Dana Reed',
            ])
            ->assertOk()
            ->assertJsonPath('existingAccount', true)
            ->assertJsonPath('invited', false);

        $this->assertTrue(
            CompanyMember::query()
                ->where('company_id', $company->id)
                ->where('user_id', $person->id)
                ->current()
                ->exists()
        );
        Mail::assertSent(Postcard::class, function (Postcard $mail) {
            return $mail->hasTo('dana@galaxy.example')
                && str_contains($mail->subjectLine, 'You have been added')
                && str_contains($mail->subjectLine, 'service provider contact');
        });
    }

    public function test_the_model_can_draft_the_invitation_card_in_chat(): void
    {
        [, , $spAdmin] = $this->galaxyAdmin();

        Http::fake([
            'api.groq.com/*' => Http::sequence()
                ->push($this->toolCallResponse([['name' => 'invite_provider_contact', 'args' => [
                    'email' => 'djboy.vf@gmail.com',
                    'name' => 'DJ Boy',
                ]]]))
                ->push($this->textResponse('I have prepared an invitation for that address as a service provider contact at Galaxy. Add is below.')),
        ]);

        $payload = $this->actingAs($spAdmin)
            ->postJson('/portal/bespoke/chat', [
                'messages' => [['role' => 'user', 'content' => 'can you add djboy.vf@gmail.com to have access to the portal?']],
                'clientContext' => ['path' => '/'],
            ])
            ->assertOk()
            ->json();

        $this->assertSame('model', $payload['source']);
        $this->assertCount(1, $payload['actions']);
        $this->assertSame('invite-provider-contact', $payload['actions'][0]['type']);
        $this->assertSame('djboy.vf@gmail.com', $payload['actions'][0]['email']);
        $this->assertStringContainsString('Add is below', $payload['reply']);
        $this->assertSame(0, Invitation::query()->count());
    }

    public function test_the_endpoint_is_dark_with_the_flag_off(): void
    {
        config(['services.bespoke.enabled' => false]);
        [, , $spAdmin] = $this->galaxyAdmin();

        $this->actingAs($spAdmin)->postJson('/portal/bespoke/actions/invite-provider-contact', [
            'email' => 'djboy.vf@gmail.com',
        ])->assertNotFound();
    }

    public function test_home_suggestions_offer_adding_a_colleague(): void
    {
        [, , $spAdmin] = $this->galaxyAdmin();

        $ids = array_column(
            $this->actingAs($spAdmin)->getJson('/portal/bespoke/suggestions?path=/')->assertOk()->json('chips'),
            'id'
        );

        $this->assertContains('invite-colleague', $ids);
    }
}
