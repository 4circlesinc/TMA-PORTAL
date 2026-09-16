<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cache\SoftCache;
use App\Support\SecurityPolicies;
use Illuminate\Cache\ArrayStore;
use Illuminate\Contracts\Cache\Store;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use RuntimeException;
use Tests\TestCase;

/**
 * The cache is an accelerator, not a dependency.
 *
 * Production's cache is a managed Redis over TLS. When it stalls or refuses
 * connections the screens that read through it must still answer from
 * Postgres: the portal home's KPI row, the account directory, and the
 * sign-in policy every request consults in middleware. Before this, a cache
 * exception surfaced as the request failing outright, after the client had
 * waited out its socket timeout.
 */
class CacheOutageTest extends TestCase
{
    use RefreshDatabase;

    private RecordingStore $store;

    protected function setUp(): void
    {
        parent::setUp();

        // The creator is rebound to the cache manager, so capture the store
        // rather than reaching for $this inside it.
        $store = $this->store = new RecordingStore;
        Cache::extend('recording', function () use ($store) {
            return Cache::repository($store);
        });
        config(['cache.stores.recording' => ['driver' => 'recording'], 'cache.default' => 'recording']);
        SoftCache::reset();

        $this->assertSame($store, Cache::getStore());
    }

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_metrics_row_is_measured_when_the_cache_is_away(): void
    {
        $admin = $this->admin();
        Client::create(['uid' => 'client-1', 'name' => 'A Client', 'email' => 'client@example.com', 'data' => []]);
        $this->store->fail = true;

        $response = $this->actingAs($admin)->getJson('/portal/dashboard/metrics?period=week');

        $response->assertOk()
            ->assertJsonPath('staff', true)
            ->assertJsonPath('period', 'week');
        $this->assertArrayHasKey('clientResponse', $response->json('cards'));
    }

    public function test_metrics_row_is_still_cached_when_the_store_answers(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->getJson('/portal/dashboard/metrics?period=week')->assertOk();
        $this->actingAs($admin)->getJson('/portal/dashboard/metrics?period=week')->assertOk();

        $this->assertSame(1, $this->store->writes["dashboard-metrics.week-monday.{$admin->id}.week"] ?? 0);
    }

    public function test_account_directory_lists_when_the_cache_is_away(): void
    {
        $admin = $this->admin();
        User::factory()->count(3)->create(['account_type' => Role::EMPLOYEE, 'status' => 'approved']);
        $this->store->fail = true;

        $response = $this->actingAs($admin)->getJson('/admin/users');

        $response->assertOk();
        $this->assertCount(4, $response->json('users'));
        $this->assertFalse($response->json('orgRequiresAuthenticator'));
    }

    public function test_sign_in_policy_reads_fall_through_to_the_database(): void
    {
        $this->store->fail = true;

        SecurityPolicies::put('sign-in', ['requireAuthenticatorForAccountTypes' => [Role::ADMINISTRATOR]]);

        $this->assertSame([Role::ADMINISTRATOR], SecurityPolicies::authenticatorRequiredAccountTypes());
        $this->assertTrue(SecurityPolicies::authenticatorRequired($this->admin()));
    }

    public function test_account_directory_reads_the_sign_in_policy_once_not_per_row(): void
    {
        $admin = $this->admin();
        User::factory()->count(12)->create(['account_type' => Role::EMPLOYEE, 'status' => 'approved']);

        $this->actingAs($admin)->getJson('/admin/users')->assertOk();

        // Middleware consults the policy for the request itself; the table
        // must not add a read for every row on top of that.
        $this->assertLessThanOrEqual(3, $this->store->reads['portal-settings.sign-in'] ?? 0);
    }
}

/**
 * An array store that can be told to behave like an unreachable Redis, and
 * that counts what the app asked it for either way.
 */
final class RecordingStore implements Store
{
    public bool $fail = false;

    /** @var array<string, int> */
    public array $reads = [];

    /** @var array<string, int> */
    public array $writes = [];

    private ArrayStore $inner;

    public function __construct()
    {
        $this->inner = new ArrayStore;
    }

    private function guard(): void
    {
        if ($this->fail) {
            throw new RuntimeException('Connection timed out [tls://cache.internal:6379]');
        }
    }

    public function get($key)
    {
        $this->reads[$key] = ($this->reads[$key] ?? 0) + 1;
        $this->guard();

        return $this->inner->get($key);
    }

    public function many(array $keys)
    {
        $this->guard();

        return $this->inner->many($keys);
    }

    public function put($key, $value, $seconds)
    {
        $this->writes[$key] = ($this->writes[$key] ?? 0) + 1;
        $this->guard();

        return $this->inner->put($key, $value, $seconds);
    }

    public function putMany(array $values, $seconds)
    {
        $this->guard();

        return $this->inner->putMany($values, $seconds);
    }

    public function increment($key, $value = 1)
    {
        $this->guard();

        return $this->inner->increment($key, $value);
    }

    public function decrement($key, $value = 1)
    {
        $this->guard();

        return $this->inner->decrement($key, $value);
    }

    public function forever($key, $value)
    {
        $this->guard();

        return $this->inner->forever($key, $value);
    }

    public function forget($key)
    {
        $this->guard();

        return $this->inner->forget($key);
    }

    public function touch($key, $seconds)
    {
        $this->guard();

        return $this->inner->touch($key, $seconds);
    }

    public function flush()
    {
        $this->guard();

        return $this->inner->flush();
    }

    public function getPrefix()
    {
        return '';
    }
}
