<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Notifications\MessagePush;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

/**
 * A message on a CIP file's thread on an iPhone: laid out as a group (who
 * wrote it, the file's number, the message) under the client's photo, with a
 * Reply box that posts back into the same lane.
 */
class CipThreadPushTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);

        $ec = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($ec, $pem);
        config([
            'services.fcm.project_id' => null,
            'services.apns.key_id' => 'APNSKEY123', 'services.apns.team_id' => 'TEAM123456',
            'services.apns.bundle_id' => 'com.tmantoinelaw.portal', 'services.apns.private_key' => $pem,
        ]);
        Http::fake(['api.push.apple.com/*' => Http::response('', 200)]);
        Mail::fake();
    }

    private function user(string $type, string $email, string $name): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $user;
    }

    /** @return array{0: User, 1: User, 2: CipApplication} */
    private function filed(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        DeviceToken::create(['user_id' => $staff->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $client = Client::create([
            'uid' => 'chen-wei', 'name' => 'Chen Wei', 'email' => 'chen@example.com',
            'created_by' => $staff->id, 'data' => [],
            'photo_url' => '/media/avatars/0b6e8f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg',
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'general', 'status' => CompanyMember::STATUS_ACTIVE, 'added_by' => $staff->id,
        ]);

        return [$staff, $contact, $application];
    }

    public function test_a_file_thread_message_says_who_then_the_file_then_the_message(): void
    {
        [$staff, $contact, $application] = $this->filed();

        $this->actingAs($contact)
            ->postJson('/portal/cip/applications/'.$application->uuid.'/messages', ['body' => 'The passport scan is attached.'])
            ->assertCreated();

        $sent = Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), '/3/device/'.self::PHONE));
        $this->assertNotEmpty($sent, 'the administrator\'s phone heard it');
        $body = $sent->last()[0]->data();
        $number = $application->fresh()->displayNumber();

        $this->assertSame(['title' => 'Gil Contact', 'subtitle' => $number, 'body' => 'The passport scan is attached.'], $body['aps']['alert']);
        $this->assertSame('MESSAGE', $body['aps']['category'], 'a Reply box');
        $this->assertSame('cip:'.$application->uuid, $body['aps']['thread-id']);

        $msg = json_decode($body['msg'], true);
        $this->assertSame($number, $msg['group']);
        $this->assertStringContainsString('/media/avatars/0b6e8f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg/push?expires=', $msg['groupPhoto'], 'the client\'s photo');
        $this->assertStringContainsString('/push/cip/'.$application->uuid.'/'.$staff->id.'/provider?expires=', $msg['reply'], 'back into the provider lane');
    }

    public function test_a_reply_from_notification_center_posts_on_the_thread_in_that_lane(): void
    {
        [$staff, , $application] = $this->filed();
        $url = URL::temporarySignedRoute('cip.push-reply', now()->addDays(MessagePush::REPLY_DAYS), [
            'application' => $application->uuid, 'user' => $staff->id, 'lane' => 'provider',
        ]);

        $this->postJson($url, ['body' => 'Thanks, received.', 'device' => self::PHONE])
            ->assertCreated()
            ->assertJsonPath('lane', 'provider');

        $message = CipApplicationMessage::query()->where('application_id', $application->id)->latest('id')->first();
        $this->assertSame('Thanks, received.', $message->body);
        $this->assertSame($staff->id, (int) $message->author_id);

        $this->postJson($url, ['body' => 'Again', 'device' => str_repeat('f', 64)])->assertForbidden();
    }
}
