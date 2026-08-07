<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * What we say — and record — when a provider turns someone away.
 *
 * Every refusal used to come back as "Connection cancelled - nothing was
 * changed." with nothing written to the log. That reading is right for exactly
 * one case (the person clicked Cancel) and actively misleading for the rest: a
 * Microsoft 365 tenant that restricts app consent refuses in the same shape,
 * and the person is then told they cancelled something they did not, on the
 * sign-in screen, with no hint that retrying cannot help. Staff signing in with
 * their work accounts hit precisely that and simply tried again, repeatedly.
 *
 * So: name the ones we can name, never claim someone cancelled unless they did,
 * and always leave the provider's own reason in the log.
 */
class SocialSignInRefusalTest extends TestCase
{
    use RefreshDatabase;

    /** The callback for a signed-out visitor lands back on the sign-in screen. */
    private function refuse(array $query): TestResponse
    {
        return $this->get('/auth/social/microsoft/callback?'.http_build_query($query));
    }

    public function test_a_tenant_that_requires_admin_consent_says_so(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS65001: The user or administrator has not consented to use the application.',
        ])
            ->assertRedirect(route('login'))
            ->assertSessionHas(
                'social_error',
                'Your Microsoft administrator needs to approve the portal before you can sign in this way.',
            );
    }

    public function test_an_admin_consent_required_error_says_so_too(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS90094: The grant requires admin permission.',
        ])->assertSessionHas(
            'social_error',
            'Your Microsoft administrator needs to approve the portal before you can sign in this way.',
        );
    }

    /**
     * The one that turns new starters away while every existing account keeps
     * working: "user assignment required" is on, and nobody assigned them.
     * It used to land on the unnamed catch-all, which pointed at the portal's
     * Microsoft access — the one thing that was not wrong.
     */
    public function test_an_unassigned_account_is_told_it_was_never_given_access(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS50105: Your administrator has configured the application to block users unless they are specifically granted access.',
        ])->assertSessionHas(
            'social_error',
            "Your Microsoft administrator hasn't given your account access to the portal yet.",
        );
    }

    /** Declining and being bounced off "Need admin approval" look identical. */
    public function test_an_unapproved_consent_does_not_accuse_the_person_of_cancelling(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS65004: User declined to consent to access the app.',
        ])->assertSessionHas(
            'social_error',
            "Microsoft sign-in wasn't approved - if you weren't offered a choice, your administrator has to approve the portal.",
        );
    }

    public function test_an_account_outside_the_organisation_is_told_so(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS50020: User account from identity provider does not exist in tenant.',
        ])->assertSessionHas(
            'social_error',
            "That Microsoft account isn't part of the organisation the portal signs people in from.",
        );
    }

    /**
     * Conditional access blocks the sign-in, not the app — so "approve the
     * portal" is advice that cannot work. It still must not read as a cancel.
     */
    public function test_a_conditional_access_block_names_the_security_policy(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS53003: Access has been blocked by Conditional Access policies.',
        ])->assertSessionHas(
            'social_error',
            "Your organisation's security policy blocked this sign-in - your Microsoft administrator can say why.",
        );
    }

    public function test_someone_who_actually_cancelled_is_told_they_cancelled(): void
    {
        $this->refuse(['error' => 'access_denied'])
            ->assertSessionHas('social_error', 'Microsoft sign-in was cancelled - nothing was changed.');
    }

    /**
     * A broken app registration is ours to fix. Sending these people to their
     * own administrator wastes everybody's time - nothing in their tenant can
     * put it right.
     */
    public function test_a_registration_fault_is_pointed_at_support_not_their_admin(): void
    {
        $this->refuse(['error' => 'unauthorized_client', 'error_description' => 'Something we have not named.'])
            ->assertSessionHas(
                'social_error',
                "The portal's Microsoft connection needs attention - please contact support.",
            );
    }

    /**
     * An unnamed code still has to be readable back to support, otherwise the
     * only record of it is a log the person reporting it cannot reach.
     */
    public function test_an_unnamed_refusal_carries_its_code(): void
    {
        $this->refuse(['error' => 'access_denied', 'error_description' => 'AADSTS99999: Something new.'])
            ->assertSessionHas(
                'social_error',
                "Microsoft sign-in was refused (AADSTS99999). Ask an administrator to check the portal's Microsoft access.",
            );
    }

    public function test_the_providers_own_reason_reaches_the_log(): void
    {
        Log::shouldReceive('warning')
            ->once()
            ->withArgs(function (string $message, array $context) {
                return $message === 'Social sign-in refused by provider'
                    && $context['provider'] === 'microsoft'
                    && $context['error'] === 'access_denied'
                    && $context['error_subcode'] === 'cancel'
                    && str_contains($context['error_description'], 'AADSTS65001');
            });

        // Other channels stay open — this test is about the one call above.
        Log::shouldReceive('error')->zeroOrMoreTimes();
        Log::shouldReceive('info')->zeroOrMoreTimes();
        Log::shouldReceive('debug')->zeroOrMoreTimes();

        $this->refuse([
            'error' => 'access_denied',
            'error_subcode' => 'cancel',
            'error_description' => 'AADSTS65001: The user or administrator has not consented.',
        ]);
    }
}
