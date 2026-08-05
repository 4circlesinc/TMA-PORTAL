<?php

namespace Tests\Feature;

use App\Mail\Transport\MicrosoftGraphTransport;
use ReflectionMethod;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Tests\TestCase;

/**
 * A misconfigured environment must not be able to send as a domain the mailbox
 * has no claim to.
 *
 * config/mail.php falls back to Laravel's stock `hello@example.com` when
 * MAIL_FROM_ADDRESS is unset. Production missed that one variable and stamped
 * every message From: example.com — Graph accepted it, nothing errored, and the
 * mail was binned on the receiving side for failing SPF alignment. Nothing in
 * the portal could see it: the delivery row said "sent".
 */
class GraphSenderDomainTest extends TestCase
{
    private function fromAddressFor(string $configuredFrom): string
    {
        $transport = new MicrosoftGraphTransport(
            'tenant-id', 'client-id', 'client-secret', 'portal@tmantoinelaw.com',
        );

        $method = new ReflectionMethod($transport, 'fromAddress');
        $email = (new Email)->from(new Address($configuredFrom, 'TM ANTOINE Advisory'));

        return $method->invoke($transport, $email)['emailAddress']['address'];
    }

    public function test_it_rewrites_a_foreign_from_address_to_the_sending_mailbox(): void
    {
        $this->assertSame(
            'portal@tmantoinelaw.com',
            $this->fromAddressFor('hello@example.com'),
        );
    }

    public function test_it_leaves_an_address_on_the_mailbox_domain_alone(): void
    {
        $this->assertSame(
            'noreply@tmantoinelaw.com',
            $this->fromAddressFor('noreply@tmantoinelaw.com'),
        );
        $this->assertSame(
            'portal@tmantoinelaw.com',
            $this->fromAddressFor('portal@tmantoinelaw.com'),
        );
    }

    public function test_it_keeps_the_configured_display_name_when_it_rewrites(): void
    {
        $transport = new MicrosoftGraphTransport(
            'tenant-id', 'client-id', 'client-secret', 'portal@tmantoinelaw.com',
        );
        $method = new ReflectionMethod($transport, 'fromAddress');
        $email = (new Email)->from(new Address('hello@example.com', 'TM ANTOINE Advisory'));

        $row = $method->invoke($transport, $email)['emailAddress'];

        $this->assertSame('portal@tmantoinelaw.com', $row['address']);
        $this->assertSame('TM ANTOINE Advisory', $row['name']);
    }
}
