<?php

namespace App\Support\Session;

use Illuminate\Session\DatabaseSessionHandler;

/**
 * The stock database handler rewrites the whole session row on every request,
 * and on this portal nearly every request is an XHR poll whose session bytes
 * are identical to the ones just read - so the busiest write in the schema
 * was an UPDATE that changed nothing but last_activity, paid to a remote
 * Postgres on every poll of every open tab.
 *
 * This handler remembers what read() returned. A write of byte-identical
 * data is skipped outright while last_activity is fresh, and bumps only
 * last_activity once it staled past TOUCH_SECONDS, so expiry, the Security
 * page's "last active" and the admin last-seen keep moving at a granularity
 * nobody can see. Anything that actually changes the session - login,
 * logout, flash data, a token cycle - is byte-different and takes the
 * parent's full write, including the ip/user-agent refresh.
 *
 * Kept on the database driver on purpose: the sessions table is load-bearing
 * for the Security settings list, revoke-by-digest, admin force sign-out and
 * last-seen, which a Redis session store cannot answer (no per-user
 * enumeration).
 */
class ThrottledDatabaseSessionHandler extends DatabaseSessionHandler
{
    /** Seconds a byte-identical session may ride on its stored last_activity. */
    public const TOUCH_SECONDS = 300;

    protected ?string $readId = null;

    protected ?string $readPayload = null;

    protected int $readLastActivity = 0;

    /**
     * {@inheritdoc}
     *
     * Same behaviour as the parent; the row it fetched is remembered so
     * write() can tell an unchanged session from a changed one.
     *
     * @return string|false
     */
    public function read($sessionId): string|false
    {
        $session = (object) $this->getQuery()->find($sessionId);

        if ($this->expired($session)) {
            $this->exists = true;

            return '';
        }

        if (isset($session->payload)) {
            $this->exists = true;
            $this->readId = $sessionId;
            $this->readPayload = base64_decode($session->payload);
            $this->readLastActivity = (int) ($session->last_activity ?? 0);

            return $this->readPayload;
        }

        return '';
    }

    /**
     * {@inheritdoc}
     *
     * @return bool
     */
    public function write($sessionId, $data): bool
    {
        // The id must match what was read: a regenerated session (login)
        // writes under a new id and must take the full insert path.
        if ($this->exists && $sessionId === $this->readId && $data === $this->readPayload) {
            $now = $this->currentTime();

            if ($now - $this->readLastActivity < self::TOUCH_SECONDS) {
                return true;
            }

            $this->getQuery()->where('id', $sessionId)->update(['last_activity' => $now]);
            $this->readLastActivity = $now;

            return true;
        }

        return parent::write($sessionId, $data);
    }
}
