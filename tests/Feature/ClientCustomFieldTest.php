<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\ClientCustomFields;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Account settings > Client hub management > Custom fields.
 *
 * The old screen kept a list of field names in localStorage that nothing ever
 * collected a value for. These cover the half that makes it a feature: values
 * reach the client record, and sanitise() keeps them honest as the definitions
 * change underneath them.
 */
class ClientCustomFieldTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        ClientCustomFields::flush();
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function clientPayload(array $custom = []): array
    {
        return [
            'uid' => 'acme-co',
            'name' => 'Acme Co',
            'profile' => [
                'emails' => ['owner@acme.test'],
                'custom' => $custom,
            ],
        ];
    }

    /* ── defining fields ─────────────────────────────────────────────── */

    public function test_an_administrator_can_define_edit_and_delete_a_field(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $id = $this->actingAs($admin)->postJson('/admin/client-fields', [
            'label' => 'Client reference',
            'type' => 'text',
        ])->assertCreated()->json('field.id');

        $this->actingAs($admin)->putJson('/admin/client-fields/'.$id, [
            'label' => 'Reference',
            'type' => 'text',
            'required' => true,
        ])->assertOk()
            ->assertJsonPath('field.label', 'Reference')
            ->assertJsonPath('field.required', true);

        $this->actingAs($admin)->deleteJson('/admin/client-fields/'.$id)
            ->assertOk()
            ->assertJsonPath('fields', []);
    }

    public function test_a_dropdown_needs_options(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->postJson('/admin/client-fields', [
            'label' => 'Region',
            'type' => 'select',
            'options' => [],
        ])->assertStatus(422);
    }

    public function test_renaming_a_field_keeps_its_id_so_stored_answers_survive(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Ref', 'text', [], false);

        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'ACME-1']))
            ->assertOk();

        $this->actingAs($admin)->putJson('/admin/client-fields/'.$field['id'], [
            'label' => 'Client reference',
            'type' => 'text',
        ])->assertOk();

        // The id is what answers are filed under; renaming must not orphan them.
        $client = Client::where('uid', 'acme-co')->first();
        $this->assertSame('ACME-1', $client->data['custom'][$field['id']]);
    }

    public function test_only_administrators_can_change_custom_fields(): void
    {
        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $type) {
            $this->actingAs($this->user($type))->postJson('/admin/client-fields', [
                'label' => 'Mine',
                'type' => 'text',
            ])->assertForbidden();
        }
    }

    /* ── collecting values ───────────────────────────────────────────── */

    public function test_a_value_is_stored_on_the_client_record(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Client reference', 'text', [], false);

        $this->actingAs($admin)
            ->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'ACME-1']))
            ->assertOk();

        $this->assertSame('ACME-1', Client::where('uid', 'acme-co')->first()->data['custom'][$field['id']]);
    }

    public function test_a_value_for_a_field_that_does_not_exist_is_dropped(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        ClientCustomFields::create('Client reference', 'text', [], false);

        $this->actingAs($admin)
            ->postJson('/portal/clients', $this->clientPayload(['not-a-real-field' => 'smuggled']))
            ->assertOk();

        // Nothing outside the definitions is kept — otherwise the blob becomes
        // a place to write arbitrary data through the client form.
        $this->assertArrayNotHasKey('custom', Client::where('uid', 'acme-co')->first()->data);
    }

    public function test_a_dropdown_cannot_hold_a_value_that_is_not_one_of_its_options(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Region', 'select', ['North', 'South'], false);

        $this->actingAs($admin)
            ->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'Atlantis']))
            ->assertOk();

        $this->assertArrayNotHasKey('custom', Client::where('uid', 'acme-co')->first()->data);
    }

    public function test_removing_an_option_stops_clients_keeping_it_on_their_next_save(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Region', 'select', ['North', 'South'], false);

        $this->actingAs($admin)
            ->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'South']))
            ->assertOk();

        $this->actingAs($admin)->putJson('/admin/client-fields/'.$field['id'], [
            'label' => 'Region',
            'type' => 'select',
            'options' => ['North'],
        ])->assertOk();

        // Re-save the client with the value it still holds.
        $this->actingAs($admin)
            ->patchJson('/portal/clients/acme-co', $this->clientPayload([$field['id'] => 'South']))
            ->assertOk();

        $this->assertArrayNotHasKey('custom', Client::where('uid', 'acme-co')->first()->data);
    }

    public function test_numbers_and_dates_are_stored_in_their_own_shape(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $number = ClientCustomFields::create('Headcount', 'number', [], false);
        $date = ClientCustomFields::create('Engaged on', 'date', [], false);

        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload([
            $number['id'] => '42',
            $date['id'] => '2026-03-01',
        ]))->assertOk();

        $custom = Client::where('uid', 'acme-co')->first()->data['custom'];

        $this->assertEquals(42, $custom[$number['id']]);
        $this->assertSame('2026-03-01', $custom[$date['id']]);
    }

    public function test_an_unparseable_value_is_dropped_rather_than_stored_as_text(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $number = ClientCustomFields::create('Headcount', 'number', [], false);

        $this->actingAs($admin)
            ->postJson('/portal/clients', $this->clientPayload([$number['id'] => 'lots']))
            ->assertOk();

        $this->assertArrayNotHasKey('custom', Client::where('uid', 'acme-co')->first()->data);
    }

    /* ── required fields ─────────────────────────────────────────────── */

    public function test_a_required_field_is_reported_missing_but_never_blocks_a_save(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        ClientCustomFields::create('Client reference', 'text', [], true);

        // Making a field required must not retroactively invalidate every
        // existing client and block edits to unrelated details.
        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload())->assertOk();

        $client = Client::where('uid', 'acme-co')->first();
        $this->assertSame(['Client reference'], ClientCustomFields::missingRequired($client->data));
    }

    /* ── what the screens are told ───────────────────────────────────── */

    public function test_the_client_list_carries_the_definitions_so_the_form_can_draw_them(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        ClientCustomFields::create('Client reference', 'text', [], false);

        $this->actingAs($admin)->getJson('/portal/clients')
            ->assertOk()
            ->assertJsonPath('customFields.0.label', 'Client reference');
    }

    public function test_the_settings_screen_counts_how_many_clients_answered_each_field(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Client reference', 'text', [], false);

        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'ACME-1']))->assertOk();
        $this->actingAs($admin)->postJson('/portal/clients', [
            'uid' => 'beta-co',
            'name' => 'Beta Co',
            'profile' => ['emails' => ['owner@beta.test']],
        ])->assertOk();

        // "Delete this field" and "delete the answers clients gave it" are the
        // same click, so the count has to be on the screen.
        $this->actingAs($admin)->getJson('/admin/client-fields')
            ->assertOk()
            ->assertJsonPath('usage.'.$field['id'], 1)
            ->assertJsonPath('clientCount', 2);
    }

    public function test_deleting_a_field_stops_its_values_being_read(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $field = ClientCustomFields::create('Client reference', 'text', [], false);

        $this->actingAs($admin)->postJson('/portal/clients', $this->clientPayload([$field['id'] => 'ACME-1']))->assertOk();

        $this->actingAs($admin)->deleteJson('/admin/client-fields/'.$field['id'])->assertOk();

        // The stored value is not swept out of every record, but nothing reads
        // it and the next write drops it.
        $this->actingAs($admin)->patchJson('/portal/clients/acme-co', $this->clientPayload([$field['id'] => 'ACME-1']))->assertOk();

        $this->assertArrayNotHasKey('custom', Client::where('uid', 'acme-co')->first()->data);
    }
}
