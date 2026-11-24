<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\StaySignedIn;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AppReviewAccountCommandTest extends TestCase
{
    use RefreshDatabase;

    private function runCommand(array $args): array
    {
        $code = Artisan::call('app-review:account', $args);
        $output = Artisan::output();
        preg_match('/^([A-Za-z0-9]{20})$/m', $output, $m);

        return [$code, $output, $m[1] ?? null];
    }

    public function test_it_creates_an_approved_client_on_its_own_client_record(): void
    {
        [$code, $output, $password] = $this->runCommand(['email' => 'AppReview@Example.com']);

        $this->assertSame(0, $code, $output);
        $this->assertNotNull($password, $output);

        $user = User::where('email', 'appreview@example.com')->firstOrFail();
        $this->assertSame(Role::CLIENT, $user->account_type);
        $this->assertSame(User::STATUS_APPROVED, $user->status);
        $this->assertNotNull($user->email_verified_at);
        $this->assertNotNull($user->profile_completed_at);
        $this->assertNotNull($user->onboarding_completed_at);
        $this->assertNotNull($user->privacy_policy_accepted_at);
        $this->assertTrue(Hash::check($password, $user->password));

        $client = Client::where('user_id', $user->id)->firstOrFail();
        $this->assertSame('Demo Client', $client->name);
        $this->assertNotNull($client->fresh()->folder_id);
    }

    public function test_the_reviewer_signs_in_from_a_new_device_straight_to_the_dashboard(): void
    {
        config(['auth.review_accounts' => ['appreview@example.com']]);
        [, , $password] = $this->runCommand(['email' => 'appreview@example.com']);
        $user = User::where('email', 'appreview@example.com')->firstOrFail();
        AuthEvent::create([
            'user_id' => $user->id, 'event' => 'login', 'ip' => '10.0.0.9',
            'user_agent' => 'OldBrowser', 'created_at' => now()->subDay(),
        ]);

        $this->withCookie(StaySignedIn::COOKIE, 'yes')
            ->post('/auth/login', ['email' => 'appreview@example.com', 'password' => $password])
            ->assertRedirect('/');

        $this->get('/')->assertOk();
    }

    public function test_it_uses_a_client_record_that_already_has_the_address(): void
    {
        $existing = Client::create([
            'uid' => 'sample-client', 'name' => 'Sample Client', 'client_type' => 'private',
            'email' => 'appreview@example.com', 'data' => [],
        ]);

        $this->runCommand(['email' => 'appreview@example.com']);

        $user = User::where('email', 'appreview@example.com')->firstOrFail();
        $this->assertSame($user->id, $existing->fresh()->user_id);
        $this->assertSame(1, Client::count());
    }

    public function test_a_second_run_keeps_the_password_unless_asked_to_reset_it(): void
    {
        [, , $password] = $this->runCommand(['email' => 'appreview@example.com']);

        [$code, $output, $again] = $this->runCommand(['email' => 'appreview@example.com']);
        $this->assertSame(0, $code);
        $this->assertNull($again, $output);
        $this->assertTrue(Hash::check($password, User::where('email', 'appreview@example.com')->value('password')));

        [, , $fresh] = $this->runCommand(['email' => 'appreview@example.com', '--reset-password' => true]);
        $this->assertNotNull($fresh);
        $this->assertNotSame($password, $fresh);
        $this->assertTrue(Hash::check($fresh, User::where('email', 'appreview@example.com')->value('password')));
        $this->assertSame(1, User::where('email', 'appreview@example.com')->count());
    }

    public function test_it_refuses_a_staff_or_administrator_account(): void
    {
        $admin = User::factory()->create(['email' => 'boss@example.com', 'account_type' => Role::ADMINISTRATOR]);
        $before = $admin->password;

        [$code, $output] = $this->runCommand(['email' => 'boss@example.com', '--reset-password' => true]);

        $this->assertSame(1, $code, $output);
        $this->assertSame($before, $admin->fresh()->password);
        $this->assertSame($admin->account_type, $admin->fresh()->account_type);
    }

    public function test_it_says_when_the_address_is_missing_from_app_review_emails(): void
    {
        config(['auth.review_accounts' => []]);

        [, $output] = $this->runCommand(['email' => 'appreview@example.com']);

        $this->assertStringContainsString('APP_REVIEW_EMAILS', $output);
    }
}
