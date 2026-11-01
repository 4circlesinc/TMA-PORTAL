<?php

namespace App\Support\Cip;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Extra addresses typed into the CC field of a status change.
 *
 * They are not members of the standing notice list. The person moving the
 * file named them for this one notice, and that is the whole of their claim
 * on it.
 */
class StatusCopies
{
    public const MAX = 10;

    /**
     * Routes whose dialog asks for a copy of the status notice. A later
     * write in that same request, such as the checklist settling the file,
     * does not take the list again.
     *
     * @var list<string>
     */
    private const ROUTES = [
        'cip.applications.status',
        'cip.applications.submit',
        'cip.applications.decision',
        'cip.applications.query',
        'cip.applications.dd-query',
        'cip.applications.acceptance',
        'cip.applications.appeal-request',
        'cip.applications.appeal',
        'cip.applications.appeal-ready',
        'cip.applications.appeal-submitted',
        'cip.applications.stage',
        'cip.applications.post-approval',
        'cip.people.status',
    ];

    /**
     * The addresses named on this status change, once.
     *
     * @return list<string>
     */
    public static function take(): array
    {
        $request = request();

        if (! $request instanceof Request || $request->attributes->has('cip.status_copies') || ! self::askedOn($request)) {
            return [];
        }

        $request->attributes->set('cip.status_copies', true);

        return self::pull();
    }

    private static function askedOn(Request $request): bool
    {
        $name = $request->route()?->getName();

        return is_string($name) && in_array($name, self::ROUTES, true);
    }

    /**
     * @return list<string>
     */
    public static function pull(): array
    {
        $request = request();
        if ($request === null || ! $request->exists('cc')) {
            return [];
        }

        $raw = $request->input('cc');
        $parts = is_array($raw)
            ? $raw
            : (preg_split('/[,;\s]+/', (string) $raw) ?: []);

        $emails = [];
        foreach ($parts as $part) {
            $email = trim((string) $part);
            if ($email === '') {
                continue;
            }

            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw ValidationException::withMessages([
                    'cc' => $email.' is not an email address.',
                ]);
            }

            $emails[mb_strtolower($email)] = $email;
        }

        if (count($emails) > self::MAX) {
            throw ValidationException::withMessages([
                'cc' => 'CC up to '.self::MAX.' addresses.',
            ]);
        }

        return array_values($emails);
    }
}
