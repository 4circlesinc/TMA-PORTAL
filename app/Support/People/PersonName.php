<?php

namespace App\Support\People;

use App\Models\User;
use Illuminate\Support\Str;

/**
 * A person's name, including the case where the only thing we were given is
 * their email address.
 *
 * Service-provider contacts are often added as an address and nothing else.
 * Microsoft and Google sometimes hand back that same address as the display
 * name. Splitting on spaces then stores the whole mailbox as the first name
 * (`camila.carvalho@immigrantinvest.com`) with the surname typed in later.
 * The local part is the name: `camila.carvalho` is Camila Carvalho.
 */
final class PersonName
{
    /**
     * @return array{first: string, middle: string, last: string}
     */
    public static function split(?string $name, ?string $email = null): array
    {
        $name = trim((string) $name);
        $tokens = preg_split('/\s+/', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $mailbox = null;
        $words = [];

        foreach ($tokens as $token) {
            if (self::looksLikeEmail($token)) {
                $mailbox ??= $token;
            } else {
                $words[] = $token;
            }
        }

        if ($mailbox !== null || ($name === '' && self::looksLikeEmail((string) $email))) {
            $fromMailbox = self::fromMailbox($mailbox ?: (string) $email);
            if ($words === []) {
                return $fromMailbox;
            }

            // A surname typed next to the address wins over the one guessed
            // from the mailbox. The address itself is never a first name.
            $last = (string) array_pop($words);

            return [
                'first' => $fromMailbox['first'],
                'middle' => $words !== [] ? implode(' ', $words) : $fromMailbox['middle'],
                'last' => $last !== '' ? $last : $fromMailbox['last'],
            ];
        }

        $first = (string) (array_shift($tokens) ?: '');
        $last = $tokens !== [] ? (string) array_pop($tokens) : '';

        return [
            'first' => $first,
            'middle' => $tokens !== [] ? implode(' ', $tokens) : '',
            'last' => $last,
        ];
    }

    /**
     * @return array{first: string, middle: string, last: string}
     */
    public static function fromMailbox(string $email): array
    {
        $local = strstr($email, '@', true);
        if ($local === false) {
            $local = $email;
        }

        $bits = preg_split('/[._+\-]+/', trim((string) $local), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $bits = array_values(array_filter(
            $bits,
            fn (string $bit) => ! preg_match('/^\d+$/', $bit),
        ));
        $bits = array_map(
            fn (string $bit) => Str::title(Str::lower($bit)),
            $bits,
        );

        $first = (string) (array_shift($bits) ?: '');
        $last = $bits !== [] ? (string) array_pop($bits) : '';

        return [
            'first' => $first,
            'middle' => $bits !== [] ? implode(' ', $bits) : '',
            'last' => $last,
        ];
    }

    public static function looksLikeEmail(string $value): bool
    {
        return str_contains($value, '@');
    }

    /**
     * Rewrite a stored first name that is really an email address.
     *
     * A last name somebody already typed is left alone. The display name is
     * rebuilt from the parts so the directory stops leading with the mailbox.
     */
    public static function repair(User $user): bool
    {
        $first = trim((string) $user->first_name);
        if ($first === '' || ! self::looksLikeEmail($first)) {
            return false;
        }

        $parts = self::split($first, $user->email);
        if ($parts['first'] === '' || $parts['first'] === $first) {
            return false;
        }

        $last = trim((string) $user->last_name);
        $middle = trim((string) $user->middle_name);

        $user->forceFill([
            'first_name' => $parts['first'],
            'middle_name' => $middle !== '' ? $middle : ($parts['middle'] !== '' ? $parts['middle'] : null),
            'last_name' => $last !== '' ? $last : ($parts['last'] !== '' ? $parts['last'] : null),
        ]);
        $user->syncDisplayName();
        $user->save();

        return true;
    }
}
