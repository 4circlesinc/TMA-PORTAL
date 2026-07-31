<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Every portal page, walked as an employee and as a client.
 *
 * The Users page shipped open to employees because nothing enumerated the
 * nav — each gate was checked in isolation, so a page nobody thought about
 * stayed open by default. This walks the whole list and prints what each role
 * reaches, so "what can an employee actually open?" has one answer.
 */
class EmployeeReachTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /**
     * Every page slug the portal serves, sorted so the snapshot below reads as
     * a set rather than as the order of a constant. '/settings' is excluded:
     * it is a redirect to /account-settings, so it never answers 200 for
     * anyone.
     */
    private function pages(): array
    {
        $pages = array_values(array_diff(array_merge(
            \App\Http\Controllers\LegacyPageController::SPA_PAGES,
            \App\Http\Controllers\LegacyPageController::STANDALONE_PAGES,
        ), ['settings']));

        sort($pages);

        return $pages;
    }

    public function test_the_administration_pages_are_closed_to_employees(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        foreach (['users', 'users/new', 'overview', 'people',
            'people/employees', 'people/clients', 'people/prospects',
            'people/shared-address-book', 'people/personal-address-book',
            'people/distribution-groups', 'people/resend-welcome-emails'] as $page) {
            $this->actingAs($employee)->get('/'.$page)
                ->assertNotFound('/'.$page.' should be closed to an employee');
        }
    }

    public function test_an_administrator_reaches_every_page(): void
    {
        // The counterweight: gating must never lock an administrator out.
        $admin = $this->user(Role::ADMINISTRATOR);

        foreach ($this->pages() as $page) {
            $this->actingAs($admin)->get('/'.$page)
                ->assertOk('/'.$page.' should be open to an administrator');
        }
    }

    public function test_the_reachable_set_is_what_we_think_it_is(): void
    {
        // A snapshot, so widening access to any page is a visible diff in this
        // test rather than something noticed in production months later.
        $reach = [];
        foreach ([Role::EMPLOYEE, Role::CLIENT] as $accountType) {
            $user = $this->user($accountType);
            foreach ($this->pages() as $page) {
                if ($this->actingAs($user)->get('/'.$page)->getStatusCode() === 200) {
                    $reach[$accountType][] = $page;
                }
            }
        }

        $this->assertSame([
            'account', 'account-info', 'account-settings', 'billing-details',
            'billing-details/card', 'calendar', 'choose-account-type',
            'classic', 'clients', 'email', 'email/templates', 'projects',
            'settings/change-email', 'signatures', 'social/feed',
            'social/messages',
        ], $reach[Role::EMPLOYEE], 'the pages an employee reaches have changed');

        $this->assertSame([
            'account', 'account-info', 'account-settings', 'billing-details',
            'billing-details/card', 'calendar', 'choose-account-type',
            'classic', 'projects', 'settings/change-email', 'signatures',
            'social/messages',
        ], $reach[Role::CLIENT], 'the pages a client reaches have changed');
    }
}
