<?php

namespace Tests\Feature;

use App\Http\Controllers\LegacyPageController;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Every portal page, walked as employee-like staff and as a client.
 *
 * The Users page shipped open to employees because nothing enumerated the
 * nav — each gate was checked in isolation, so a page nobody thought about
 * stayed open by default. This walks the whole list and prints what each role
 * reaches, so "what can employee-like staff actually open?" has one answer.
 *
 * 'Employee' itself is a parked type now: an approved account still typed
 * Employee is held on /auth/role-pending until an administrator assigns a
 * real role. The officer types carry the whole Employee capability baseline,
 * so the reach walked here uses a Reviewing Officer — the same expectations
 * the Employee walk used to pin.
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
     * anyone. '/clients' is the same kind of leftover: it redirects to
     * /citizenship-applications.
     */
    private function pages(): array
    {
        $pages = array_values(array_diff(array_merge(
            LegacyPageController::SPA_PAGES,
            LegacyPageController::STANDALONE_PAGES,
        ), ['settings', 'clients']));

        sort($pages);

        return $pages;
    }

    public function test_the_administration_pages_are_closed_to_employee_like_staff(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);

        foreach (['users', 'users/new', 'reporting', 'people',
            'people/employees', 'people/clients', 'people/prospects',
            'people/shared-address-book', 'people/personal-address-book',
            'people/distribution-groups', 'people/resend-welcome-emails'] as $page) {
            $this->actingAs($officer)->get('/'.$page)
                ->assertNotFound('/'.$page.' should be closed to a reviewing officer');
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
        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $accountType) {
            $user = $this->user($accountType);
            foreach ($this->pages() as $page) {
                if ($this->actingAs($user)->get('/'.$page)->getStatusCode() === 200) {
                    $reach[$accountType][] = $page;
                }
            }
        }

        $this->assertSame([
            'account', 'account-info', 'account-settings', 'billing-details',
            'billing-details/card', 'calendar', 'call-recordings',
            'choose-account-type',
            'citizenship-applications', 'classic', 'email', 'email/templates', 'folders/all',
            'folders/clients', 'folders/favorites', 'folders/filebox', 'folders/personal',
            'folders/recent', 'folders/recycle', 'folders/shared',
            'folders/shared-with-me', 'overview',
            'settings/change-email', 'signatures', 'social/feed',
            'social/messages', 'workflows', 'workflows/feedback', 'workflows/updates',
        ], $reach[Role::REVIEWING_OFFICER], 'the pages employee-like staff reach have changed');

        // A client keeps their own File Library screens; the two
        // organization-wide ones (All Files, Shared Folders) are staff.
        $this->assertSame([
            'account', 'account-info', 'account-settings', 'billing-details',
            'billing-details/card', 'calendar', 'choose-account-type',
            'classic', 'folders/clients', 'folders/favorites', 'folders/filebox',
            'folders/personal', 'folders/recent', 'folders/recycle',
            'folders/shared-with-me',
            'settings/change-email', 'signatures', 'social/messages',
        ], $reach[Role::CLIENT], 'the pages a client reaches have changed');
    }

    public function test_the_projects_pages_are_gone_for_everyone(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        foreach (['projects', 'projects/all', 'projects/closed', 'projects/recently_deleted'] as $page) {
            $this->actingAs($admin)->get('/'.$page)
                ->assertNotFound('/'.$page.' should no longer be served');
        }

        $html = $this->actingAs($admin)->get('/')->assertOk()->getContent();
        $this->assertStringNotContainsString('data-expand="projects"', $html);
        $this->assertStringNotContainsString('data-nav="projects-all"', $html);
        $this->assertStringNotContainsString('data-view="projects-hub"', $html);
    }

    public function test_the_templates_page_is_gone_for_everyone(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->get('/templates')
            ->assertNotFound('/templates should no longer be served');

        $html = $this->actingAs($admin)->get('/')->assertOk()->getContent();
        $this->assertStringNotContainsString('data-nav="templates"', $html);
        $this->assertStringNotContainsString('data-view="templates"', $html);
        $this->assertStringNotContainsString('href="/templates"', $html);
    }

    public function test_an_approved_employee_is_held_on_the_role_pending_screen(): void
    {
        // 'Employee' is a parked type: approval alone no longer opens the
        // portal. Until an administrator assigns a real role, every portal
        // page sends the account to /auth/role-pending.
        $employee = $this->user(Role::EMPLOYEE);

        $this->actingAs($employee)->get('/overview')
            ->assertRedirect('/auth/role-pending');
    }
}
