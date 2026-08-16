<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The client book's catch-up read — the third cursor, and the one the
 * offline plan's "eleven thousand clients is a large first sync" sentence
 * was written about. Same contract as the other two: scope is the reader's
 * own slice, deletions arrive as tombstone rows, the boundary row comes
 * again (inclusive tie-break), and a nonsense cursor is no cursor.
 */
class ClientsSyncTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function client(User $creator, array $attrs = []): Client
    {
        return Client::create(array_merge([
            'uid' => 'c-'.uniqid(),
            'name' => 'Client '.uniqid(),
            'created_by' => $creator->id,
            'data' => ['profile' => ['firstName' => 'Test']],
        ], $attrs));
    }

    private function sync(User $as, array $query = [])
    {
        return $this->actingAs($as)->getJson(
            '/portal/clients/sync'.($query ? '?'.http_build_query($query) : ''),
        );
    }

    public function test_no_cursor_returns_full_records(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);

        $res = $this->sync($staff);

        $res->assertOk();
        $record = collect($res->json('clients'))->firstWhere('id', $client->uid);
        $this->assertNotNull($record);
        // The full record, not the directory's lean row: the replica exists
        // so a profile can open offline for a client nobody clicked before.
        $this->assertArrayHasKey('profile', $record);
        $this->assertFalse($res->json('more'));
    }

    public function test_a_client_account_is_refused(): void
    {
        $client = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->sync($client)->assertForbidden();
    }

    public function test_the_cursor_returns_only_what_moved(): void
    {
        $staff = $this->staff();
        $old = $this->client($staff);
        $old->forceFill(['updated_at' => now()->subDay()])->saveQuietly();
        $fresh = $this->client($staff);

        $uids = array_column(
            $this->sync($staff, ['since' => now()->subHours(2)->toIso8601String()])->json('clients'),
            'id',
        );

        $this->assertSame([$fresh->uid], $uids);
    }

    public function test_a_deletion_arrives_as_a_tombstone(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $cursor = now()->subHour()->toIso8601String();

        $client->delete();

        $record = collect($this->sync($staff, ['since' => $cursor])->json('clients'))
            ->firstWhere('id', $client->uid);

        $this->assertNotNull($record);
        $this->assertTrue($record['deleted']);
        $this->assertArrayNotHasKey('profile', $record);
    }

    public function test_the_boundary_row_is_redelivered(): void
    {
        $staff = $this->staff();
        $stamp = now()->startOfSecond();
        $first = $this->client($staff);
        $second = $this->client($staff);
        $first->forceFill(['updated_at' => $stamp])->saveQuietly();
        $second->forceFill(['updated_at' => $stamp])->saveQuietly();

        $uids = array_column($this->sync($staff, [
            'since' => $stamp->toIso8601String(),
            'after' => $first->id,
        ])->json('clients'), 'id');

        // Inclusive tie-break: the row the cursor ended on comes again, so a
        // same-instant second change can never be skipped for ever.
        $this->assertSame([$first->uid, $second->uid], $uids);
    }

    public function test_a_nonsense_cursor_is_no_cursor(): void
    {
        $staff = $this->staff();
        $this->client($staff);

        $res = $this->sync($staff, ['since' => 'whenever']);

        $res->assertOk();
        $this->assertCount(1, $res->json('clients'));
    }
}
