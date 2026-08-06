<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
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
    private function refuse(array $query): \Illuminate\Testing\TestResponse
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

    public function test_a_conditional_access_block_is_not_reported_as_a_cancellation(): void
    {
        $this->refuse([
            'error' => 'access_denied',
            'error_description' => 'AADSTS53003: Access has been blocked by Conditional Access policies.',
        ])->assertSessionHas(
            'social_error',
            'Your Microsoft administrator needs to approve the portal before you can sign in this way.',
        );
    }

    public function test_someone_who_actually_cancelled_is_told_they_cancelled(): void
    {
        $this->refuse(['error' => 'access_denied'])
            ->assertSessionHas('social_error', 'Microsoft sign-in was cancelled - nothing was changed.');
    }

    public function test_an_unnamed_refusal_points_at_an_administrator_rather_than_a_retry(): void
    {
        $this->refuse(['error' => 'unauthorized_client', 'error_description' => 'Something we have not named.'])
            ->assertSessionHas(
                'social_error',
                "Microsoft sign-in was refused. Ask an administrator to check the portal's Microsoft access.",
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
