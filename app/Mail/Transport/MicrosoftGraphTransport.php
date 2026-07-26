<?php

namespace App\Mail\Transport;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\MessageConverter;
use Symfony\Component\Mime\Part\DataPart;

/**
 * Sends portal system mail through Microsoft Graph with an app-only token
 * (client credentials). No SMTP, no mailbox password, no MFA prompt.
 *
 * Requires Entra application permission Mail.Send + admin consent, and a
 * real tenant ID (not "common"). Prefer an Application Access Policy that
 * limits the app to the configured sender mailbox only.
 */
class MicrosoftGraphTransport extends AbstractTransport
{
    public function __construct(
        private string $tenantId,
        private string $clientId,
        private string $clientSecret,
        private string $mailbox,
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        $email = MessageConverter::toEmail($message->getOriginalMessage());
        $payload = [
            'message' => $this->graphMessage($email),
            'saveToSentItems' => true,
        ];

        $response = Http::withToken($this->accessToken())
            ->acceptJson()
            ->timeout(30)
            ->post(
                'https://graph.microsoft.com/v1.0/users/'.rawurlencode($this->mailbox).'/sendMail',
                $payload,
            );

        if ($response->successful()) {
            return;
        }

        $detail = $response->json('error.message')
            ?: $response->body()
            ?: 'unknown Graph error';

        throw new RuntimeException(
            'Microsoft Graph sendMail failed ('.$response->status().'): '.$detail
        );
    }

    public function __toString(): string
    {
        return 'microsoft-graph';
    }

    /**
     * @return array<string, mixed>
     */
    private function graphMessage(Email $email): array
    {
        $html = $email->getHtmlBody();
        $text = $email->getTextBody();

        if (is_string($html) && $html !== '') {
            $body = ['contentType' => 'HTML', 'content' => $html];
        } else {
            $body = ['contentType' => 'Text', 'content' => (string) ($text ?? '')];
        }

        $message = [
            'subject' => $email->getSubject() ?? '',
            'body' => $body,
            'toRecipients' => $this->recipients($email->getTo()),
        ];

        if ($from = $this->fromAddress($email)) {
            $message['from'] = $from;
        }

        if ($cc = $this->recipients($email->getCc())) {
            $message['ccRecipients'] = $cc;
        }

        if ($bcc = $this->recipients($email->getBcc())) {
            $message['bccRecipients'] = $bcc;
        }

        if ($replyTo = $this->recipients($email->getReplyTo())) {
            $message['replyTo'] = $replyTo;
        }

        $attachments = $this->attachments($email);
        if ($attachments !== []) {
            $message['attachments'] = $attachments;
        }

        return $message;
    }

    /**
     * Prefer Laravel's configured From name over the Exchange mailbox display name.
     *
     * @return array{emailAddress: array{address: string, name?: string}}|null
     */
    private function fromAddress(Email $email): ?array
    {
        $from = $email->getFrom();
        if ($from === []) {
            return null;
        }

        $address = $from[0];
        $row = ['emailAddress' => ['address' => $address->getAddress()]];
        $name = $address->getName() !== ''
            ? $address->getName()
            : (string) config('mail.from.name', '');
        if ($name !== '') {
            $row['emailAddress']['name'] = $name;
        }

        return $row;
    }

    /**
     * @param  Address[]  $addresses
     * @return list<array{emailAddress: array{address: string, name?: string}}>
     */
    private function recipients(array $addresses): array
    {
        $out = [];
        foreach ($addresses as $address) {
            $row = ['emailAddress' => ['address' => $address->getAddress()]];
            if ($address->getName() !== '') {
                $row['emailAddress']['name'] = $address->getName();
            }
            $out[] = $row;
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function attachments(Email $email): array
    {
        $out = [];
        foreach ($email->getAttachments() as $part) {
            if (! $part instanceof DataPart) {
                continue;
            }
            $out[] = [
                '@odata.type' => '#microsoft.graph.fileAttachment',
                'name' => $part->getFilename() ?: 'attachment',
                'contentType' => $part->getContentType() ?: 'application/octet-stream',
                'contentBytes' => base64_encode($part->getBody()),
            ];
        }

        return $out;
    }

    private function accessToken(): string
    {
        $cacheKey = 'microsoft-graph.mail.token.'.sha1($this->tenantId.'|'.$this->clientId);

        return Cache::remember($cacheKey, now()->addMinutes(50), function () {
            $response = Http::asForm()
                ->timeout(20)
                ->post(
                    'https://login.microsoftonline.com/'.rawurlencode($this->tenantId).'/oauth2/v2.0/token',
                    [
                        'client_id' => $this->clientId,
                        'client_secret' => $this->clientSecret,
                        'scope' => 'https://graph.microsoft.com/.default',
                        'grant_type' => 'client_credentials',
                    ],
                );

            if (! $response->successful() || ! $response->json('access_token')) {
                $detail = $response->json('error_description')
                    ?: $response->json('error')
                    ?: $response->body()
                    ?: 'token request failed';

                throw new RuntimeException('Microsoft Graph token failed: '.$detail);
            }

            return (string) $response->json('access_token');
        });
    }
}
