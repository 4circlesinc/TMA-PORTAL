<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Profile Details card, end to end.
 *
 * The card renders straight from `/me`, which is why the fields it shows have
 * to be in that payload: before this they were absent, so Company, Contact
 * Phone, Job title and LinkedIn rendered a dash for every account no matter
 * what the person had actually filled in.
 */
class ProfileDetailsTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType = Role::EMPLOYEE, array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    public function test_me_carries_every_field_the_card_shows(): void
    {
        $user = $this->user(Role::EMPLOYEE, [
            'phone' => '+1 555 123 4567',
            'job_title' => 'Paralegal',
            'company' => 'TM ANTOINE Advisory',
            'linkedin_url' => 'https://linkedin.com/in/vernon-francis',
        ]);

        $this->actingAs($user)
            ->getJson('/me')
            ->assertOk()
            ->assertJsonPath('phone', '+1 555 123 4567')
            ->assertJsonPath('jobTitle', 'Paralegal')
            ->assertJsonPath('company', 'TM ANTOINE Advisory')
            ->assertJsonPath('linkedin', 'https://linkedin.com/in/vernon-francis');
    }

    /**
     * A client's company was already recorded by staff on the client record.
     * Making them retype it would be the only way to see it on their own card.
     */
    public function test_a_client_inherits_the_company_from_their_client_record(): void
    {
        $client = $this->user(Role::CLIENT);
        Client::create([
            'uid' => (string) Str::uuid(),
            'user_id' => $client->id,
            'name' => $client->name,
            'company' => 'Kyle Ltd',
            'email' => $client->email,
            'data' => [],
        ]);

        $this->actingAs($client)->getJson('/me')->assertOk()->assertJsonPath('company', 'Kyle Ltd');
    }

    public function test_their_own_company_wins_over_the_inherited_one(): void
    {
        $client = $this->user(Role::CLIENT, ['company' => 'Kyle Holdings']);
        Client::create([
            'uid' => (string) Str::uuid(),
            'user_id' => $client->id,
            'name' => $client->name,
            'company' => 'Kyle Ltd',
            'email' => $client->email,
            'data' => [],
        ]);

        $this->actingAs($client)->getJson('/me')->assertOk()->assertJsonPath('company', 'Kyle Holdings');
    }

    /**
     * The editor must show what is *stored*, not the inherited value — saving
     * the form would otherwise copy the client record onto the account and
     * freeze it there.
     */
    public function test_the_editor_separates_the_stored_company_from_the_inherited_one(): void
    {
        $client = $this->user(Role::CLIENT);
        Client::create([
            'uid' => (string) Str::uuid(),
            'user_id' => $client->id,
            'name' => $client->name,
            'company' => 'Kyle Ltd',
            'email' => $client->email,
            'data' => [],
        ]);

        $this->actingAs($client)
            ->getJson('/me/profile')
            ->assertOk()
            ->assertJsonPath('company', null)
            ->assertJsonPath('companyInherited', 'Kyle Ltd');
    }

    public function test_edit_profile_saves_the_company_and_linkedin(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/profile', [
                'first_name' => 'Vernon',
                'last_name' => 'Francis',
                'phone' => '+1 555 123 4567',
                'job_title' => 'Attorney',
                'company' => 'TM ANTOINE Advisory',
                'linkedin_url' => 'linkedin.com/in/vernon-francis',
            ])
            ->assertOk();

        $user->refresh();

        $this->assertSame('TM ANTOINE Advisory', $user->company);
        $this->assertSame('Attorney', $user->job_title);
        // Typed without a scheme, stored with one, so the card's link works.
        $this->assertSame('https://linkedin.com/in/vernon-francis', $user->linkedin_url);
    }

    public function test_it_refuses_a_company_longer_than_the_column(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/profile', [
                'first_name' => 'Vernon',
                'last_name' => 'Francis',
                'company' => str_repeat('a', 161),
            ])
            ->assertJsonValidationErrorFor('company');
    }

    public function test_it_still_refuses_a_link_that_is_not_linkedin(): void
    {
        $user = $this->user();

        $this->actingAs($user)
            ->putJson('/profile', [
                'first_name' => 'Vernon',
                'last_name' => 'Francis',
                'linkedin_url' => 'https://example.com/vernon',
            ])
            ->assertJsonValidationErrorFor('linkedin_url');
    }
}
