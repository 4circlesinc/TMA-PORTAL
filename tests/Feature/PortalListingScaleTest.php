<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\ConnectedAccount;
use App\Models\Contact;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Invitation;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The portal's other main listings, held to the same rule as the CIP
 * applications table: a page must cost a fixed number of queries, not one
 * per row.
 *
 * Same method as {@see CipListingScaleTest}: hit the endpoint with the query
 * log on and look for a query SHAPE that ran more than once. A shape running
 * twice on ten seed rows is a shape running a hundred and fifty times on a
 * real page, which is the only thing that matters here.
 */
class PortalListingScaleTest extends TestCase
{
    use RefreshDatabase;

    private const ROWS = 10;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();

        // The Files listing writes nothing, but the disk config must be sane
        // for the same reasons FileManagerTest pins it.
        $this->vaultRoot = sys_get_temp_dir().'/tma-scale-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
    }

    protected function tearDown(): void
    {
        @rmdir($this->vaultRoot);
        parent::tearDown();
    }

    /* ── harness ──────────────────────────────────────────────────── */

    private function admin(string $email = 'ada-portal-scale@example.com'): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @return array{count:int, queries:list<string>} */
    private function measure(callable $fn): array
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $fn();
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        return [
            'count' => count($log),
            'queries' => array_map(fn ($q) => $q['query'], $log),
        ];
    }

    /**
     * The query shapes a listing repeats, and how often.
     *
     * Bind values are stripped so `in (?, ?)` and `in (?, ?, ?)` are one
     * shape, and `where id = ?` repeated per row is caught as one shape
     * running many times. Lifted verbatim from CipListingScaleTest.
     *
     * @param  list<string>  $queries
     * @return array<string, int>
     */
    private function repeats(array $queries): array
    {
        $shapes = [];

        foreach ($queries as $query) {
            $shape = preg_replace('/\s+/', ' ', trim($query));
            $shape = preg_replace('/\((\s*\?\s*,)+\s*\?\s*\)/', '(?)', $shape);
            $shapes[$shape] = ($shapes[$shape] ?? 0) + 1;
        }

        // Fixed per-request cost from several independent memoised callers,
        // the same whether the page holds ten rows or a hundred and fifty.
        unset($shapes['select * from "portal_settings" where "key" = ? limit 1']);

        return array_filter($shapes, fn (int $n) => $n > 1);
    }

    /** @param array<string, int> $repeats */
    private function explain(string $listing, array $repeats): string
    {
        return $listing." repeated a query shape, so something is measured per row:\n".
            implode("\n", array_map(
                fn (string $shape, int $n) => $n.'x  '.substr($shape, 0, 200),
                array_keys($repeats),
                $repeats,
            ));
    }

    /**
     * The one assertion that actually distinguishes an N+1 from a batch.
     *
     * A repeated shape is not enough on its own here: a listing that eager
     * loads owners, folders, favourites and shares legitimately runs one
     * `where id in (...)` per relation, and the same shape appears twice when
     * files and folders are primed separately. Those costs are fixed - they
     * do not grow with the page. So the listing is measured twice, at two
     * very different row counts, and what must hold is that the bigger page
     * costs no more queries than the small one. That is exactly the property
     * the CIP applications table had lost, and exactly the one a batch primer
     * restores.
     *
     * @param  callable(int, int): void  $seed  seeds rows [from, to)
     * @param  callable(): void  $hit  performs the listing request
     */
    private function assertFlat(string $name, callable $seed, callable $hit): void
    {
        $seed(0, self::ROWS);
        $small = $this->measure($hit);

        $seed(self::ROWS, self::ROWS * 6);
        $large = $this->measure($hit);

        $this->assertLessThanOrEqual(
            $small['count'],
            $large['count'],
            $name.' cost '.$large['count'].' queries for '.(self::ROWS * 6).' rows but only '.
            $small['count'].' for '.self::ROWS.", so something is measured per row:\n".
            $this->explain($name, $this->repeats($large['queries'])),
        );
    }

    /* ── 1. Clients directory ─────────────────────────────────────── */

    public function test_the_clients_directory_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $company = Company::create(['uid' => 'acme-scale', 'name' => 'Acme', 'created_by' => $staff->id]);
        $referrer = Company::create(['uid' => 'ref-scale', 'name' => 'Referrer', 'created_by' => $staff->id]);

        $seed = function (int $from, int $to) use ($staff, $company, $referrer) {
            for ($i = $from; $i < $to; $i++) {
                // Every client carries the relations the directory row reads:
                // a company, a referring company, a portal login and a folder.
                $account = User::factory()->create([
                    'email' => 'client'.$i.'-scale@example.com',
                    'status' => 'approved',
                    'account_type' => 'Client',
                    'email_verified_at' => now(),
                ]);

                $folder = Folder::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => 'Client '.$i,
                    'owner_id' => $staff->id,
                    'created_by' => $staff->id,
                    'folder_type' => Folder::TYPE_CLIENT,
                ]);

                $client = Client::create([
                    'uid' => 'client-'.$i,
                    'name' => 'Client '.$i,
                    'initial' => 'C',
                    'initial_color' => 'blue',
                    'email' => $account->email,
                    'phone' => '+1 555 '.str_pad((string) $i, 4, '0', STR_PAD_LEFT),
                    'company' => 'Acme',
                    'company_id' => $company->id,
                    'client_type' => 'private',
                    'referral_type' => Client::REFERRAL_COMPANY,
                    'referred_by_company_id' => $referrer->id,
                    'user_id' => $account->id,
                    'folder_id' => $folder->id,
                    'data' => ['firstName' => 'Client', 'lastName' => (string) $i],
                    'created_by' => $staff->id,
                ]);

                ClientAssignment::create([
                    'client_id' => $client->id,
                    'user_id' => $staff->id,
                    'role' => 'general',
                    'permission_level' => 'editor',
                    'is_primary' => true,
                    'status' => ClientAssignment::STATUS_ACTIVE,
                    'assigned_by' => $staff->id,
                ]);
            }
        };

        $this->assertFlat('The clients directory', $seed, function () {
            // The directory is kept warm for a minute. A cached answer
            // measures nothing, so each read rebuilds it.
            Cache::flush();
            $this->getJson('/portal/clients')->assertOk();
        });
    }

    /* ── 2. Files browser ─────────────────────────────────────────── */

    public function test_the_files_browser_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $parent = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Scale',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $seed = function (int $from, int $to) use ($staff, $parent) {
            for ($i = $from; $i < $to; $i++) {
                Folder::create([
                    'uuid' => (string) Str::uuid(),
                    'name' => 'Sub '.$i,
                    'parent_id' => $parent->id,
                    'owner_id' => $staff->id,
                    'created_by' => $staff->id,
                ]);

                FileItem::create([
                    'uuid' => (string) Str::uuid(),
                    'folder_id' => $parent->id,
                    'name' => 'doc'.$i.'.pdf',
                    'extension' => 'pdf',
                    'mime_type' => 'application/pdf',
                    'size' => 1024,
                    'disk' => 'local',
                    'storage_path' => 'tests/doc'.$i.'.pdf',
                    'owner_id' => $staff->id,
                    'uploaded_by' => $staff->id,
                ]);
            }
        };

        // perPage is the ceiling, so the bigger seed really does paint a
        // bigger page rather than the same first sixty rows.
        $this->assertFlat('The files browser', $seed, function () use ($parent) {
            $this->getJson('/portal/files?folder='.$parent->uuid.'&perPage=200')->assertOk();
        });
    }

    /* ── 3. Mailbox conversation listing ──────────────────────────── */

    public function test_the_mailbox_listing_costs_the_same_queries_at_any_size(): void
    {
        $user = $this->admin('mailbox-scale@example.com');
        $this->actingAs($user);

        $account = ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'p-scale',
            'email' => $user->email,
            'name' => $user->name,
            'token' => 'token',
            'scopes' => ['Mail.Read'],
            'sync_email' => true,
        ]);

        $seed = function (int $from, int $to) use ($user, $account) {
            $rows = [];
            for ($i = $from; $i < $to; $i++) {
                // Distinct senders and threads: one shared sender would hide
                // a per-sender lookup behind a single unique address.
                $rows[] = [
                    'uuid' => (string) Str::uuid(),
                    'user_id' => $user->id,
                    'connected_account_id' => $account->id,
                    'remote_id' => 'm'.$i,
                    'thread_id' => 't'.$i,
                    'folder' => 'inbox',
                    'subject' => 'Message '.$i,
                    'from_email' => 'sender'.$i.'@example.com',
                    'from_name' => 'Sender '.$i,
                    'snippet' => 'Hello '.$i,
                    'is_read' => false,
                    'is_starred' => false,
                    'is_important' => false,
                    'has_attachments' => false,
                    'sent_at' => now()->subMinutes($i),
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            MailMessage::insert($rows);
        };

        /*
         * Sender photos are resolved by a queued job, one per unseen address,
         * deliberately: a live provider lookup per sender inside the request
         * is what took the mailbox down once already. The test queue runs
         * `sync`, which would run those jobs inline and charge the listing for
         * work production does off the request. Faking the queue measures what
         * the page actually costs; that the dispatch itself is per-address and
         * deduplicated is ResolveSenderPhoto's own contract.
         */
        Queue::fake();

        $this->assertFlat('The mailbox listing', $seed, function () {
            $this->getJson('/portal/mail/messages?folder=inbox&perPage=200')->assertOk();
        });
    }

    /* ── 4. People / Contacts ─────────────────────────────────────── */

    public function test_the_employees_listing_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $seed = function (int $from, int $to) {
            for ($i = $from; $i < $to; $i++) {
                User::factory()->create([
                    'email' => 'employee'.$i.'-scale@example.com',
                    'status' => 'approved',
                    'account_type' => 'Employee',
                    'email_verified_at' => now(),
                ]);
            }
        };

        $this->assertFlat('The employees listing', $seed, function () {
            $this->getJson('/portal/people/employees')->assertOk();
        });
    }

    public function test_the_client_contacts_listing_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $seed = function (int $from, int $to) use ($staff) {
            for ($i = $from; $i < $to; $i++) {
                $account = User::factory()->create([
                    'email' => 'contact'.$i.'-scale@example.com',
                    'status' => 'approved',
                    'account_type' => 'Client',
                    'email_verified_at' => now(),
                ]);

                Client::create([
                    'uid' => 'contact-'.$i,
                    'name' => 'Contact '.$i,
                    'initial' => 'C',
                    'initial_color' => 'blue',
                    'email' => $account->email,
                    'company' => 'Acme',
                    'user_id' => $account->id,
                    'data' => [],
                    'created_by' => $staff->id,
                ]);
            }
        };

        $this->assertFlat('The client contacts listing', $seed, function () {
            $this->getJson('/portal/people/client-contacts')->assertOk();
        });
    }

    public function test_the_prospects_listing_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $seed = function (int $from, int $to) use ($staff) {
            for ($i = $from; $i < $to; $i++) {
                Invitation::create([
                    'uuid' => (string) Str::uuid(),
                    'type' => Invitation::TYPE_CLIENT,
                    'token_hash' => hash('sha256', Str::random(48)),
                    'email' => 'prospect'.$i.'-scale@example.com',
                    'name' => 'Prospect '.$i,
                    'status' => Invitation::STATUS_SENT,
                    'invited_by' => $staff->id,
                    'expires_at' => now()->addDays(7),
                ]);
            }
        };

        $this->assertFlat('The prospects listing', $seed, function () {
            $this->getJson('/portal/people/prospects')->assertOk();
        });
    }

    public function test_the_contacts_address_book_costs_the_same_queries_at_any_size(): void
    {
        $staff = $this->admin();
        $this->actingAs($staff);

        $seed = function (int $from, int $to) use ($staff) {
            for ($i = $from; $i < $to; $i++) {
                Contact::create([
                    'uuid' => (string) Str::uuid(),
                    'scope' => Contact::SCOPE_SHARED,
                    'owner_id' => $staff->id,
                    'first_name' => 'Book',
                    'last_name' => 'Entry '.$i,
                    'email' => 'book'.$i.'-scale@example.com',
                    'created_by' => $staff->id,
                ]);
            }
        };

        $this->assertFlat('The contacts address book', $seed, function () {
            $this->getJson('/portal/contacts')->assertOk();
        });
    }
}
