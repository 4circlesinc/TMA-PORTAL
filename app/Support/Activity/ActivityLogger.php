<?php

namespace App\Support\Activity;

use App\Models\ActivityLog;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Request;

/**
 * The single entry point for recording an audit-trail entry (§22).
 *
 * Callers describe an action; this fills in module/action from the type when
 * omitted, captures IP and user agent from the current request (when there is
 * one), and — critically — redacts secrets before anything is persisted (§22:
 * passwords, tokens, and file contents must never reach the log). Like the
 * Notifier, it swallows its own failures so auditing never breaks the action.
 */
final class ActivityLogger
{
    /** Type prefix → module column, so 'client.created' lands under 'clients'. */
    private const MODULE_MAP = [
        'client' => 'clients',
        'file' => 'files',
        'folder' => 'files',
        'calendar' => 'calendar',
        'event' => 'calendar',
        'email' => 'email',
        'mail' => 'email',
        'message' => 'messages',
        'conversation' => 'messages',
        'group' => 'messages',
        'signature' => 'signatures',
        'account' => 'account',
        'user' => 'account',
        'security' => 'security',
        'auth' => 'security',
        'system' => 'system',
    ];

    /** Keys whose values are never stored, at any depth of old/new/metadata. */
    private const SENSITIVE_KEYS = [
        'password', 'current_password', 'new_password', 'password_confirmation',
        'token', 'access_token', 'refresh_token', 'id_token', 'secret',
        'client_secret', 'two_factor_secret', 'two_factor_recovery_codes',
        'remember_token', 'api_key', 'authorization', 'cookie', 'ciphertext',
        'token_ciphertext', 'private_key',
    ];

    /**
     * Record one activity. Returns the row, or null if it could not be written.
     *
     * @param  array<string, mixed>  $attrs {
     *     type:        string          e.g. 'client.created' (required)
     *     description: string          human sentence (required)
     *     actor:       User|int|null   null = system
     *     module:      string|null     defaults from the type prefix
     *     action:      string|null     defaults from the type suffix
     *     subject:     Model|null
     *     client:      Client|int|null
     *     old:         array|null      before values (redacted)
     *     new:         array|null      after values (redacted)
     *     status:      string|null     success | failure | pending
     *     metadata:    array|null      (redacted)
     *     ip:          string|null     defaults from the request
     *     user_agent:  string|null     defaults from the request
     * }
     */
    public static function log(array $attrs): ?ActivityLog
    {
        try {
            return self::record($attrs);
        } catch (\Throwable $e) {
            Log::error('ActivityLogger.log failed', [
                'type' => $attrs['type'] ?? null,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private static function record(array $attrs): ?ActivityLog
    {
        $type = $attrs['type'] ?? null;
        $description = $attrs['description'] ?? null;

        if (! is_string($type) || $type === '' || ! is_string($description) || $description === '') {
            Log::warning('ActivityLogger.log skipped: missing type or description', ['type' => $type]);

            return null;
        }

        $subject = $attrs['subject'] ?? null;

        return ActivityLog::create([
            'actor_id' => self::idOf($attrs['actor'] ?? null),
            'activity_type' => $type,
            'module' => $attrs['module'] ?? self::moduleFor($type),
            'action' => $attrs['action'] ?? self::actionFor($type),
            'description' => mb_substr($description, 0, 500),
            'subject_type' => $subject instanceof Model ? $subject->getMorphClass() : null,
            'subject_id' => $subject instanceof Model ? $subject->getKey() : null,
            'client_id' => self::idOf($attrs['client'] ?? null),
            'old_values' => self::redact($attrs['old'] ?? null),
            'new_values' => self::redact($attrs['new'] ?? null),
            'ip_address' => $attrs['ip'] ?? self::currentIp(),
            'user_agent' => mb_substr((string) ($attrs['user_agent'] ?? self::currentUserAgent() ?? ''), 0, 255) ?: null,
            'status' => $attrs['status'] ?? ActivityLog::STATUS_SUCCESS,
            'metadata' => self::redact($attrs['metadata'] ?? null),
        ]);
    }

    private static function moduleFor(string $type): string
    {
        $prefix = explode('.', $type)[0] ?? 'system';

        return self::MODULE_MAP[$prefix] ?? 'system';
    }

    private static function actionFor(string $type): string
    {
        $parts = explode('.', $type);

        return $parts[1] ?? ($parts[0] ?? 'event');
    }

    /**
     * Strip sensitive keys from an array, recursively. Anything matching a
     * sensitive name is dropped entirely rather than masked, so no shape of the
     * secret survives.
     *
     * @param  mixed  $value
     */
    private static function redact(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        $clean = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && in_array(strtolower($key), self::SENSITIVE_KEYS, true)) {
                continue;
            }
            $clean[$key] = is_array($item) ? self::redact($item) : $item;
        }

        return $clean;
    }

    private static function currentIp(): ?string
    {
        if (app()->runningInConsole()) {
            return null;
        }

        try {
            return Request::ip();
        } catch (\Throwable) {
            return null;
        }
    }

    private static function currentUserAgent(): ?string
    {
        if (app()->runningInConsole()) {
            return null;
        }

        try {
            return Request::userAgent();
        } catch (\Throwable) {
            return null;
        }
    }

    private static function idOf(mixed $value): ?int
    {
        if ($value instanceof User || $value instanceof Client) {
            return (int) $value->getKey();
        }
        if (is_numeric($value)) {
            return (int) $value;
        }

        return null;
    }
}
