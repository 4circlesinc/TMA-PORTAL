<?php

namespace Tests\Feature;

use App\Support\Session\ThrottledDatabaseSessionHandler;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ThrottledSessionWriteTest extends TestCase
{
    use RefreshDatabase;

    /** A fresh handler per call, the way every request gets one. */
    private function handler(): ThrottledDatabaseSessionHandler
    {
        return new ThrottledDatabaseSessionHandler(DB::connection(), 'sessions', 120, app());
    }

    private function row(string $id): ?object
    {
        return DB::table('sessions')->where('id', $id)->first();
    }

    public function test_unchanged_fresh_session_writes_nothing(): void
    {
        $this->handler()->write('sess-a', 'the-session-bytes');

        $h = $this->handler();
        $h->read('sess-a');

        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->assertTrue($h->write('sess-a', 'the-session-bytes'));

        $writes = collect(DB::getQueryLog())->filter(
            fn ($q) => preg_match('/^\s*(update|insert)/i', $q['query'])
        );
        $this->assertCount(0, $writes, 'a byte-identical, freshly touched session must not write');
    }

    public function test_stale_activity_bumps_only_last_activity(): void
    {
        $this->handler()->write('sess-a', 'the-session-bytes');
        $before = $this->row('sess-a');
        DB::table('sessions')->where('id', 'sess-a')
            ->update(['last_activity' => now()->subMinutes(10)->getTimestamp()]);

        $h = $this->handler();
        $h->read('sess-a');
        $h->write('sess-a', 'the-session-bytes');

        $after = $this->row('sess-a');
        $this->assertGreaterThanOrEqual(now()->subMinute()->getTimestamp(), $after->last_activity);
        $this->assertSame($before->payload, $after->payload, 'the touch must not rewrite the payload');
    }

    public function test_changed_bytes_take_the_full_write(): void
    {
        $this->handler()->write('sess-a', 'the-session-bytes');

        $h = $this->handler();
        $h->read('sess-a');
        $h->write('sess-a', 'different-bytes');

        $this->assertSame('different-bytes', base64_decode($this->row('sess-a')->payload));
    }

    public function test_a_regenerated_id_inserts_a_new_row(): void
    {
        $this->handler()->write('sess-a', 'the-session-bytes');

        // Login regenerates the id: read the old row, write under a new id.
        $h = $this->handler();
        $h->read('sess-a');
        $h->setExists(false);
        $h->write('sess-b', 'the-session-bytes');

        $this->assertNotNull($this->row('sess-b'));
        $this->assertSame('the-session-bytes', base64_decode($this->row('sess-b')->payload));
    }

    public function test_the_database_driver_resolves_to_the_throttled_handler(): void
    {
        config(['session.driver' => 'database']);

        $handler = app('session')->driver('database')->getHandler();

        $this->assertInstanceOf(ThrottledDatabaseSessionHandler::class, $handler);
    }
}
