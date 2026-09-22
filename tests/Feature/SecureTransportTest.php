<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The claim the service-provider briefing makes about the network:
 *
 *   "On the way: the lock in the browser (https). Someone watching the
 *    network cannot read the pages or the files."
 *
 * Four things have to hold for that sentence to be true, and each one is a
 * test here: plain http is never served, a password is never redirected
 * (only refused), every response tells the browser never to try http again,
 * and no page is allowed to pull a subresource over http.
 *
 * The test suite runs as `testing` over http, which is deliberate — a dev box
 * must not need TLS. So each test sets app.url to an https origin, which is
 * what both middlewares read to decide whether this environment is one that
 * has TLS at all.
 */
class SecureTransportTest extends TestCase
{
    use RefreshDatabase;

    private function withTls(): void
    {
        config(['app.url' => 'https://portal.example.com']);
    }

    public function test_plain_http_page_request_is_redirected_to_https(): void
    {
        $this->withTls();

        $response = $this->get('http://portal.example.com/auth/login');

        $response->assertStatus(301);
        $response->assertRedirect('https://portal.example.com/auth/login');
    }

    public function test_the_query_string_survives_the_redirect(): void
    {
        $this->withTls();

        // An invite or a signing link carries its token in the URL. Dropping
        // it would send the visitor to a page that cannot serve them.
        $this->get('http://portal.example.com/auth/login?next=%2Fportal%2Ffiles')
            ->assertRedirect('https://portal.example.com/auth/login?next=%2Fportal%2Ffiles');
    }

    public function test_a_plain_http_post_is_refused_rather_than_redirected(): void
    {
        $this->withTls();

        /*
         * The bytes are already on the wire by the time this is seen. A 301
         * would tell the client to send that password a second time, so the
         * only honest answer is to refuse it.
         */
        $this->post('http://portal.example.com/auth/login', [
            'email' => 'someone@example.com',
            'password' => 'hunter2',
        ])->assertStatus(400);
    }

    public function test_the_health_check_is_not_redirected(): void
    {
        $this->withTls();

        // It runs inside the platform network, where there is no TLS to
        // terminate. Redirecting it reads as an unhealthy container.
        $this->get('http://portal.example.com/up')->assertOk();
    }

    public function test_http_is_untouched_where_there_is_no_tls(): void
    {
        // Local dev and the Docker stack serve plain http on purpose.
        config(['app.url' => 'http://localhost']);

        $this->get('http://localhost/auth/login')->assertOk();
    }

    public function test_responses_carry_a_preloadable_hsts_header(): void
    {
        $this->withTls();

        $header = $this->get('https://portal.example.com/auth/login')
            ->headers->get('Strict-Transport-Security');

        // The exact form the browser preload lists require: at least a year,
        // every subdomain, and the preload token.
        $this->assertStringContainsString('max-age=31536000', (string) $header);
        $this->assertStringContainsString('includeSubDomains', (string) $header);
        $this->assertStringContainsString('preload', (string) $header);
    }

    public function test_pages_may_not_load_anything_over_http(): void
    {
        $this->withTls();

        $csp = (string) $this->get('https://portal.example.com/auth/login')
            ->headers->get('Content-Security-Policy');

        /*
         * HSTS covers the document. This covers everything the document then
         * asks for — a script, an image, a file — so a single http URL
         * anywhere in the app is upgraded rather than sent in the clear.
         */
        $this->assertStringContainsString('upgrade-insecure-requests', $csp);
    }
}
