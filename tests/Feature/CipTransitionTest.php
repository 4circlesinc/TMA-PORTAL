<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * §6 — the lifecycle over HTTP.
 *
 * The engine's own rules are proved in {@see CipEngineTest}; what is proved
 * here is that the endpoint is a door to them and not a second set of them: a
 * legal edge goes through, an illegal one comes back as the caller's mistake
 * rather than a server fault, and an actor without the capability is refused
 * with nothing written behind them.
 */
class CipTransitionTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Every edge in the lifecycle, written out rather than read from the
     * engine.
     *
     * A test that asked the map what the map allows would pass whatever the
     * map said, including a transition somebody added by accident. This is the
     * lifecycle the brief describes, stated independently.
     */
    /**
     * Targets the generic endpoint refuses because a dedicated verb owns them:
     * filing a draft checks the checklist, recording a submission carries the
     * CIP number, recording a decision stores the outcome and its date.
     */
    private const OWNED_ELSEWHERE = ['new', 'pending_review', 'granted', 'denied'];

    private const EDGES = [
        [Status::DRAFT, Status::NEW],
        [Status::NEW, Status::REVIEW_APPLICATION],
        [Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK],
        [Status::ASSESSMENT_FEEDBACK, Status::UPDATE_REQUIRED],
        [Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT],
        [Status::UPDATE_REQUIRED, Status::ASSESSMENT_FEEDBACK],
        [Status::READY_TO_SUBMIT, Status::PENDING_REVIEW],
        [Status::PENDING_REVIEW, Status::NON_COMPLIANT],
        [Status::PENDING_REVIEW, Status::BACKGROUND_CHECK],
        [Status::NON_COMPLIANT, Status::PENDING_REVIEW],
        [Status::NON_COMPLIANT, Status::BACKGROUND_CHECK],
        [Status::BACKGROUND_CHECK, Status::NON_COMPLIANT],
        [Status::BACKGROUND_CHECK, Status::DELAYED],
        [Status::BACKGROUND_CHECK, Status::GRANTED],
        [Status::BACKGROUND_CHECK, Status::DENIED],
        [Status::DELAYED, Status::NON_COMPLIANT],
        [Status::DELAYED, Status::GRANTED],
        [Status::DELAYED, Status::DENIED],
    ];

    protected function setUp(): void
    {
        parent::setUp();

        // The module ships dark behind FEATURE_CIP, and every cip.* capability
        // is denied — administrators included — while it is off.
        config(['services.cip.enabled' => true]);
    }

    private function user(string $accountType): User
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
        ]);

        // The portal's middleware group asks for all of these before a request
        // reaches a controller at all.
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ])->save();

        return $user;
    }

    private function provider(): CipProvider
    {
        return CipProvider::firstOrCreate(['code' => 'GAL'], ['name' => 'Galaxy']);
    }

    /** A draft, and the main applicant every application is filed for. */
    private function application(User $creator, array $attributes = []): CipApplication
    {
        $application = Applications::create($this->provider(), $creator, $attributes);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        return $application;
    }

    /** Put an application at a point in the lifecycle without walking it there. */
    private function at(CipApplication $application, string $status): CipApplication
    {
        $application->forceFill(['status' => $status])->save();

        return $application;
    }

    private function slot(CipApplication $application, string $type, string $label, bool $required = true): CipDocument
    {
        return CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $application->people()->first()->id,
            'type' => $type,
            'label' => $label,
            'required' => $required,
        ]);
    }

    private function statusUrl(CipApplication $application): string
    {
        return '/portal/cip/applications/'.$application->uuid.'/status';
    }

    private function submitUrl(CipApplication $application): string
    {
        return '/portal/cip/applications/'.$application->uuid.'/submit';
    }

    public function test_every_legal_edge_drives_through_the_endpoint(): void
    {
        // An administrator holds every cip.* capability, so the walk proves the
        // edges rather than the permissions — those have a test of their own.
        $admin = $this->user(Role::ADMINISTRATOR);

        foreach (self::EDGES as [$from, $to]) {
            // Four targets carry work the state alone does not — see
            // refuseIfItHasItsOwnVerb. They are walked by the tests that own
            // them, and refused here on purpose.
            if (in_array($to, self::OWNED_ELSEWHERE, true)) {
                continue;
            }

            $application = $this->at($this->application($admin), $from);

            $this->actingAs($admin)
                ->postJson($this->statusUrl($application), ['status' => $to])
                ->assertOk()
                ->assertJsonPath('application.status', $to)
                ->assertJsonPath('application.statusLabel', Status::label($to));

            $this->assertSame($to, $application->fresh()->status, $from.' → '.$to.' did not move the row');

            $this->assertDatabaseHas('cip_events', [
                'application_id' => $application->id,
                'action' => 'status_changed',
                'from_status' => $from,
                'to_status' => $to,
                'actor_id' => $admin->id,
            ]);
        }
    }

    public function test_an_edge_outside_the_lifecycle_is_refused_and_writes_nothing(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->application($admin);
        $events = CipEvent::count();

        // Nothing is granted straight out of a draft.
        $this->actingAs($admin)
            ->postJson($this->statusUrl($application), ['status' => Status::GRANTED])
            ->assertStatus(422);

        // And a status the vocabulary has never heard of is the same refusal,
        // not the 500 an uncaught argument exception would have been.
        $this->actingAs($admin)
            ->postJson($this->statusUrl($application), ['status' => 'approved_ish'])
            ->assertStatus(422);

        $this->assertSame(Status::DRAFT, $application->fresh()->status);
        $this->assertSame($events, CipEvent::count(), 'a refused transition left a trail');
    }

    public function test_an_actor_without_the_capability_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $reviewer = $this->user(Role::REVIEWING_OFFICER);

        $application = $this->at($this->application($admin), Status::PENDING_REVIEW);
        $events = CipEvent::count();

        // A Reviewing Officer may see this application and assess its
        // documents; moving it through compliance is somebody else's work.
        $this->actingAs($reviewer)
            ->postJson($this->statusUrl($application), ['status' => Status::BACKGROUND_CHECK])
            ->assertForbidden();

        $this->assertSame(Status::PENDING_REVIEW, $application->fresh()->status);
        $this->assertSame($events, CipEvent::count());
    }

    public function test_a_draft_missing_the_applicants_required_documents_cannot_be_submitted(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->application($admin);

        $this->slot($application, 'valid_passport', 'Valid passport');
        $this->slot($application, 'birth_certificate', 'Birth certificate');
        $this->slot($application, 'marriage_certificate', 'Marriage certificate', required: false);

        $events = CipEvent::count();

        $response = $this->actingAs($admin)
            ->postJson($this->submitUrl($application))
            ->assertStatus(422);

        // Named, not counted: whoever pressed submit is usually the person who
        // has to go and find them.
        $message = $response->json('message');
        $this->assertStringContainsString('Valid passport', $message);
        $this->assertStringContainsString('Birth certificate', $message);

        // An optional requirement is not a reason to hold the application.
        $this->assertStringNotContainsString('Marriage certificate', $message);
        $this->assertEqualsCanonicalizing(
            ['Valid passport', 'Birth certificate'],
            $response->json('outstanding'),
        );

        $this->assertSame(Status::DRAFT, $application->fresh()->status);
        $this->assertSame($events, CipEvent::count(), 'a refused submission half-happened');
    }

    public function test_the_creator_may_submit_their_own_draft_without_the_create_capability(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);

        // A private client: an external account that holds no matrix
        // capability by design, filing for themselves.
        $account = $this->user(Role::CLIENT);
        $client = Client::create([
            'uid' => 'chen-wei',
            'name' => 'Chen Wei',
            'user_id' => $account->id,
            'created_by' => $staff->id,
            'data' => [],
        ]);

        $application = $this->application($account, ['client_id' => $client->id]);
        $this->slot($application, 'marriage_certificate', 'Marriage certificate', required: false);

        $this->assertFalse(CipAccess::can($account, 'cip.create'), 'the premise of this test');

        $this->actingAs($account)
            ->postJson($this->submitUrl($application))
            ->assertOk()
            ->assertJsonPath('application.status', Status::NEW);

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => 'status_changed',
            'from_status' => Status::DRAFT,
            'to_status' => Status::NEW,
            'actor_id' => $account->id,
        ]);
    }

    public function test_the_available_transitions_are_the_readers_own(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $reviewer = $this->user(Role::REVIEWING_OFFICER);
        $compliance = $this->user(Role::COMPLIANCE_OFFICER);

        $application = $this->at($this->application($admin), Status::ASSESSMENT_FEEDBACK);

        // The same application, at the same point, offers each officer their
        // own work and nobody else's.
        $this->assertSame(
            [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
            Engine::availableTransitions($application, $reviewer),
        );
        $this->assertSame([], Engine::availableTransitions($application, $compliance));

        $ready = $this->at($this->application($admin), Status::READY_TO_SUBMIT);
        $this->assertSame([Status::PENDING_REVIEW], Engine::availableTransitions($ready, $compliance));
        $this->assertSame([], Engine::availableTransitions($ready, $reviewer));

        // Nothing leaves a decision, whoever is asking.
        $granted = $this->at($this->application($admin), Status::GRANTED);
        $this->assertSame([], Engine::availableTransitions($granted, $admin));
    }

    public function test_the_payload_says_what_this_reader_may_do_next(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $reviewer = $this->user(Role::REVIEWING_OFFICER);

        $application = $this->at($this->application($admin), Status::REVIEW_APPLICATION);

        $next = $this->actingAs($reviewer)
            ->postJson($this->statusUrl($application), ['status' => Status::ASSESSMENT_FEEDBACK])
            ->assertOk()
            ->json('application.availableTransitions');

        $this->assertSame(
            [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
            array_column($next, 'value'),
        );
        $this->assertSame('Update required', $next[0]['label']);
    }

    public function test_a_note_travels_into_the_audit_row(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        // An edge this endpoint actually owns: a decision has its own verb.
        $application = $this->at($this->application($admin), Status::BACKGROUND_CHECK);

        $this->actingAs($admin)
            ->postJson($this->statusUrl($application), [
                'status' => Status::DELAYED,
                'note' => 'The Unit wrote on 14 August.',
            ])->assertOk();

        $event = CipEvent::query()->latest('id')->first();

        $this->assertSame(Status::DELAYED, $event->to_status);
        $this->assertSame('The Unit wrote on 14 August.', $event->meta['note']);
    }

    public function test_an_application_the_reader_cannot_see_is_a_404(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->application($admin);
        $stranger = $this->user(Role::CLIENT);

        // 404, not 403: being refused is being told it is there.
        $this->actingAs($stranger)
            ->postJson($this->statusUrl($application), ['status' => Status::NEW])
            ->assertNotFound();

        $this->actingAs($stranger)
            ->postJson($this->submitUrl($application))
            ->assertNotFound();

        $this->assertSame(Status::DRAFT, $application->fresh()->status);
    }

    /**
     * The generic endpoint must not be a way round the verbs that guard.
     *
     * Every status below has a door of its own that does more than move the
     * row — checks the applicant's documents, records the CIP number, stores
     * the decision. Reachable here, those checks were decorative.
     */
    public function test_the_status_endpoint_refuses_the_edges_that_have_their_own_verb(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->application($staff);

        // Draft → New belongs to submit(), which checks the checklist first.
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => 'new'])
            ->assertStatus(422);

        $this->assertSame(Status::DRAFT, $application->refresh()->status, 'and it moved nothing');

        foreach (['pending_review', 'granted', 'denied'] as $owned) {
            $this->actingAs($staff)
                ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => $owned])
                ->assertStatus(422);
        }

        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_STATUS_CHANGED)->count());
    }
}
