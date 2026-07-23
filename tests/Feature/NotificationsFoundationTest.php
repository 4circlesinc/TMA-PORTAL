<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\Notification;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Notifications\NotificationPreferences;
use App\Support\Notifications\NotificationType;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class NotificationsFoundationTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
        ], $overrides));
    }

    public function test_notifier_fills_defaults_from_the_type_registry(): void
    {
        $recipient = $this->user();
        $actor = $this->user();

        $n = Notifier::send([
            'user' => $recipient,
            'actor' => $actor,
            'type' => 'file.shared',
            'title' => 'A file was shared with you',
        ]);

        $this->assertInstanceOf(Notification::class, $n);
        $this->assertSame('files', $n->module);
        $this->assertSame(Notification::LEVEL_INFO, $n->level);
        $this->assertSame('ShareNetwork', $n->icon);
        $this->assertSame('View file', $n->action_label);
        $this->assertSame('normal', $n->priority);
        $this->assertNotNull($n->uid);
        $this->assertNull($n->read_at);
    }

    public function test_notifier_never_notifies_the_actor_about_their_own_action(): void
    {
        $me = $this->user();

        $n = Notifier::send([
            'user' => $me,
            'actor' => $me,
            'type' => 'file.shared',
            'title' => 'You shared a file',
        ]);

        $this->assertNull($n);
        $this->assertSame(0, Notification::count());
    }

    public function test_preferences_can_silence_a_group_but_not_security(): void
    {
        $recipient = $this->user();
        NotificationPreferences::update($recipient, ['files' => ['portal' => false]]);
        $recipient->refresh();

        $silenced = Notifier::send([
            'user' => $recipient,
            'actor' => $this->user(),
            'type' => 'file.shared',
            'title' => 'A file was shared',
        ]);
        $this->assertNull($silenced);

        // Security alerts cannot be silenced even if the preference says off.
        NotificationPreferences::update($recipient, ['security' => ['portal' => false]]);
        $recipient->refresh();
        $security = Notifier::send([
            'user' => $recipient,
            'type' => 'security.new_login',
            'title' => 'New sign-in detected',
        ]);
        $this->assertInstanceOf(Notification::class, $security);
        $this->assertSame(Notification::LEVEL_SECURITY, $security->level);
    }

    public function test_dedupe_key_refreshes_an_existing_unread_row(): void
    {
        $recipient = $this->user();
        $actor = $this->user();

        $first = Notifier::send([
            'user' => $recipient,
            'actor' => $actor,
            'type' => 'file.shared',
            'title' => 'A file was shared',
            'dedupe_key' => 'share:42',
        ]);
        $second = Notifier::send([
            'user' => $recipient,
            'actor' => $actor,
            'type' => 'file.shared',
            'title' => '2 files were shared',
            'dedupe_key' => 'share:42',
        ]);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, Notification::count());
        $this->assertSame('2 files were shared', $second->title);
        $this->assertSame(2, $second->metadata['count']);
    }

    public function test_notify_admins_reaches_only_approved_administrators(): void
    {
        $this->user(['account_type' => 'Administrator', 'status' => 'approved']);
        $this->user(['account_type' => 'Administrator', 'status' => 'approved']);
        $this->user(['account_type' => 'Administrator', 'status' => 'pending']); // not yet approved
        $this->user(['account_type' => 'Employee', 'status' => 'approved']);

        $created = Notifier::notifyAdmins([
            'type' => 'account.pending',
            'title' => 'A new account needs approval',
        ]);

        $this->assertCount(2, $created);
        $this->assertSame(Notification::LEVEL_APPROVAL, $created[0]->level);
    }

    public function test_activity_logger_records_and_redacts_secrets(): void
    {
        $actor = $this->user();
        $client = Client::create([
            'uid' => 'acme', 'name' => 'Acme', 'data' => [], 'created_by' => $actor->id,
        ]);

        $log = ActivityLogger::log([
            'actor' => $actor,
            'type' => 'client.updated',
            'description' => 'Updated Acme',
            'subject' => $client,
            'client' => $client,
            'old' => ['name' => 'Acme', 'password' => 'hunter2', 'token' => 'abc'],
            'new' => ['name' => 'Acme Corp', 'nested' => ['secret' => 'x', 'keep' => 'y']],
        ]);

        $this->assertInstanceOf(ActivityLog::class, $log);
        $this->assertSame('clients', $log->module);
        $this->assertSame('updated', $log->action);
        $this->assertSame($actor->id, $log->actor_id);
        $this->assertArrayNotHasKey('password', $log->old_values);
        $this->assertArrayNotHasKey('token', $log->old_values);
        $this->assertSame('Acme', $log->old_values['name']);
        $this->assertArrayNotHasKey('secret', $log->new_values['nested']);
        $this->assertSame('y', $log->new_values['nested']['keep']);
        $this->assertFalse($log->isSystem());
    }

    public function test_activity_logger_marks_null_actor_as_system(): void
    {
        $log = ActivityLogger::log([
            'type' => 'system.sync_completed',
            'description' => 'Email synchronized',
        ]);

        $this->assertTrue($log->isSystem());
        $this->assertSame('system', $log->module);
    }

    public function test_registry_covers_every_documented_module(): void
    {
        $modules = array_unique(array_map(
            fn ($t) => NotificationType::module($t),
            NotificationType::all(),
        ));
        sort($modules);

        $this->assertEqualsCanonicalizing(
            ['account', 'calendar', 'clients', 'email', 'files', 'messages', 'security', 'signatures', 'system'],
            $modules,
        );
    }
}
