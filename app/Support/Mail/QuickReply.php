<?php

namespace App\Support\Mail;

use App\Models\MailMessage;
use App\Models\User;

/**
 * An email reply typed into a notification's Reply box on an iPhone
 * (PushReplyController::mail): the text as the composer would have laid it
 * out, one block per line, with the person's signature under it, addressed
 * back to whoever the email asked replies to go to.
 */
final class QuickReply
{
    public static function html(string $text, User $user): string
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($text)) ?: [];
        $html = implode('', array_map(
            fn (string $line) => trim($line) === '' ? '<div><br></div>' : '<div>'.e(rtrim($line)).'</div>',
            $lines,
        ));

        $signature = self::signature($user);

        // The same block the composer adds, so a reply from the phone signs off
        // like one written at a desk.
        return $signature === ''
            ? $html
            : $html.'<div class="tma-dash__email-compose-signature" data-email-signature><br>'.$signature.'</div>';
    }

    /**
     * The signature the composer would use: the chosen one, else the first,
     * else the single signature from before there was a list (email.js,
     * ensureSignatureLibrary).
     */
    public static function signature(User $user): string
    {
        $preferences = is_array($user->preferences) ? $user->preferences : [];
        $mail = is_array($preferences['mail'] ?? null) ? $preferences['mail'] : $preferences;

        $list = array_values(array_filter(
            is_array($mail['signatures'] ?? null) ? $mail['signatures'] : [],
            fn ($entry) => is_array($entry) && is_string($entry['html'] ?? null) && trim($entry['html']) !== '',
        ));
        $active = $mail['activeSignatureId'] ?? null;

        foreach ($list as $entry) {
            if (($entry['id'] ?? null) === $active) {
                return $entry['html'];
            }
        }

        if ($list !== []) {
            return $list[0]['html'];
        }

        return is_string($mail['signature'] ?? null) ? trim($mail['signature']) : '';
    }

    /** @return array{email: string, name?: string} */
    public static function recipient(MailMessage $original): array
    {
        $replyTo = trim((string) $original->reply_to);
        if (preg_match('/<([^>]+)>/', $replyTo, $match)) {
            $replyTo = trim($match[1]);
        }

        if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            return ['email' => $replyTo];
        }

        return array_filter([
            'email' => (string) $original->from_email,
            'name' => (string) ($original->from_name ?? ''),
        ], fn ($value) => $value !== '');
    }

    public static function subject(?string $subject): string
    {
        $subject = trim((string) $subject);

        return preg_match('/^re:/i', $subject) ? $subject : trim('Re: '.$subject);
    }
}
