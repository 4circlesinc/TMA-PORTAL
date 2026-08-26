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
use App\Support\Cip\Assignments;
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
     * CIP number, recording a query stores the date the Unit asked, recording
     * acceptance stores the date the Unit took the file, recording a decision
     * stores the outcome and its date.
     */
    private const OWNED_ELSEWHERE = ['new', 'pending_review', 'non_compliant', 'background_check', 'granted', 'denied'];

    private const EDGES = [
        [Status::DRAFT, Status::NEW],
        [Status::NEW, Status::REVIEW_APPLICATION],
        [Status::REVIEW_APPLICATION, Status::ASSESSMENT_FEEDBACK],
        [Status::ASSESSMENT_FEEDBACK, Status::UPDATE_REQUIRED],
        [Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT],
        [Status::UPDATE_REQUIRED, Status::ASSESSMENT_FEEDBACK],
        [Status::READY_TO_SUBMIT, Status::PENDING_REVIEW],
        [Status::READY_TO_SUBMIT, Status::UPDATE_REQUIRED],
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

    /** An application, and the main applicant every application is filed for. */
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
            // Targets that carry work the state alone does not — see
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

        $this->assertSame(Status::NEW, $application->fresh()->status);
        $this->assertSame($events, CipEvent::count(), 'a refused transition left a trail');
    }

    public function test_an_actor_without_the_capability_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = $this->user(Role::CLIENT);

        $application = $this->at($this->application($admin), Status::BACKGROUND_CHECK);
        $events = CipEvent::count();

        // External accounts without a slice of this file are told it does not
        // exist — never that a capability they do not hold was refused.
        $this->actingAs($client)
            ->postJson($this->statusUrl($application), ['status' => Status::DELAYED])
            ->assertNotFound();

        $this->assertSame(Status::BACKGROUND_CHECK, $application->fresh()->status);
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

        $this->assertSame(Status::NEW, $application->fresh()->status);
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
        $application->forceFill(['status' => Status::DRAFT])->save();
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
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $employee = $this->user(Role::EMPLOYEE);

        $application = $this->at($this->application($admin), Status::ASSESSMENT_FEEDBACK);

        // Officers hold both review and compliance verbs; parked employees hold
        // neither.
        $this->assertSame(
            [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
            Engine::availableTransitions($application, $officer),
        );
        $this->assertSame([], Engine::availableTransitions($application, $employee));

        $ready = $this->at($this->application($admin), Status::READY_TO_SUBMIT);
        $this->assertEqualsCanonicalizing(
            [Status::PENDING_REVIEW, Status::UPDATE_REQUIRED],
            Engine::availableTransitions($ready, $officer),
        );
        $this->assertSame([], Engine::availableTransitions($ready, $employee));

        // Nothing leaves a decision, whoever is asking.
        $granted = $this->at($this->application($admin), Status::GRANTED);
        $this->assertSame([], Engine::availableTransitions($granted, $admin));
    }

    public function test_the_payload_says_what_this_reader_may_do_next(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $reviewer = $this->user(Role::REVIEWING_OFFICER);

        $application = $this->at($this->application($admin), Status::REVIEW_APPLICATION);
        // Their file — an officer reads only what they hold.
        Assignments::assign($application->fresh(), $reviewer, $admin);
        $application = $application->fresh();

        $next = $this->actingAs($reviewer)
            ->postJson($this->statusUrl($application), ['status' => Status::ASSESSMENT_FEEDBACK])
            ->assertOk()
            ->json('application.availableTransitions');

        $this->assertSame(
            [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
            array_column($next, 'value'),
        );
        $this->assertSame('Updates Required', $next[0]['label']);
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

        $this->assertSame(Status::NEW, $application->fresh()->status);
    }

    /**
     * A file going back to the Unit with its query answered keeps its number
     * and the day it first went.
     *
     * The companion to the refusal below: Non-compliant → Pending review is
     * the one edge into Pending review that is not a first submission, and
     * asking for a CIP number the application already carries would either
     * duplicate it or overwrite it with a retype.
     */
    public function test_a_file_already_submitted_may_go_back_to_the_unit_bare(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $application = $this->at($this->application($staff), Status::NON_COMPLIANT);
        $application->forceFill([
            'cip_number' => '10T1G12661P',
            'submitted_at' => '2026-01-31',
        ])->save();

        $this->actingAs($staff)
            ->postJson($this->statusUrl($application), ['status' => 'pending_review'])
            ->assertOk()
            ->assertJsonPath('application.status', Status::PENDING_REVIEW);

        $this->assertSame('2026-01-31', $application->refresh()->submitted_at->toDateString());
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

        // Leftover Draft → New belongs to submit(), which checks the checklist.
        $draft = $this->at($this->application($staff), Status::DRAFT);
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$draft->uuid.'/status', ['status' => 'new'])
            ->assertStatus(422);

        $this->assertSame(Status::DRAFT, $draft->refresh()->status, 'and it moved nothing');

        // Ready to submit → Pending review belongs to the submission verb.
        $ready = $this->at($this->application($staff), Status::READY_TO_SUBMIT);
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$ready->uuid.'/status', ['status' => 'pending_review'])
            ->assertStatus(422);

        $this->assertSame(Status::READY_TO_SUBMIT, $ready->refresh()->status);

        /*
         * And from anywhere else it has never been submitted from.
         *
         * The guard used to name Ready to submit, but the status picker offers
         * every status from every status — so the same hole stood open one
         * step to the side, and a reader who reached Pending review from
         * anywhere but the expected step wrote no CIP number and no date. What
         * decides is whether the file has ever gone to the Unit, not where it
         * stands.
         */
        $unsent = $this->at($this->application($staff), Status::REVIEW_APPLICATION);
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$unsent->uuid.'/status', ['status' => 'pending_review'])
            ->assertStatus(422);

        $this->assertSame(Status::REVIEW_APPLICATION, $unsent->refresh()->status);
        $this->assertNull($unsent->refresh()->submitted_at);

        $pending = $this->at($this->application($staff), Status::PENDING_REVIEW);
        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$pending->uuid.'/status', ['status' => 'non_compliant'])
            ->assertStatus(422);
        $this->assertSame(Status::PENDING_REVIEW, $pending->refresh()->status);
        $this->assertNull($pending->refresh()->query_received_at);

        $this->actingAs($staff)
            ->postJson('/portal/cip/applications/'.$pending->uuid.'/status', ['status' => 'background_check'])
            ->assertStatus(422);
        $this->assertSame(Status::PENDING_REVIEW, $pending->refresh()->status);
        $this->assertNull($pending->refresh()->accepted_at);

        foreach (['granted', 'denied'] as $owned) {
            $this->actingAs($staff)
                ->postJson('/portal/cip/applications/'.$application->uuid.'/status', ['status' => $owned])
                ->assertStatus(422);
        }

        $this->assertSame(Status::NEW, $application->refresh()->status);
        $this->assertSame(0, CipEvent::where('action', CipEvent::ACTION_STATUS_CHANGED)->count());
    }

    public function test_recording_a_decision_writes_the_outcome_and_moves_the_status(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $application = $this->at($this->application($admin), Status::BACKGROUND_CHECK);

        $this->actingAs($admin)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::GRANTED,
                'decidedAt' => '2026-08-10',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::GRANTED)
            ->assertJsonPath('application.statusLabel', 'Approved')
            ->assertJsonPath('application.decidedAt', '2026-08-10')
            ->assertJsonPath('application.decision', Status::GRANTED);

        $fresh = $application->fresh();
        $this->assertSame(Status::GRANTED, $fresh->status);
        $this->assertSame(CipApplication::DECISION_GRANTED, $fresh->decision);
        $this->assertSame('2026-08-10', $fresh->decided_at->toDateString());

        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_DECISION_RECORDED,
            'actor_id' => $admin->id,
        ]);
        $this->assertDatabaseHas('cip_events', [
            'application_id' => $application->id,
            'action' => CipEvent::ACTION_STATUS_CHANGED,
            'from_status' => Status::BACKGROUND_CHECK,
            'to_status' => Status::GRANTED,
        ]);
    }

    public function test_an_officer_may_record_a_decision(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $reviewer = $this->user(Role::REVIEWING_OFFICER);
        $application = $this->at($this->application($admin), Status::BACKGROUND_CHECK);
        Assignments::assign($application->fresh(), $reviewer, $admin);
        $application = $application->fresh();

        $this->actingAs($reviewer)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/decision', [
                'decision' => Status::DENIED,
                'decidedAt' => '2026-08-10',
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::DENIED);
    }
}