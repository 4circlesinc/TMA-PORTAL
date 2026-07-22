<?php

namespace App\Support\Dashboard;

use Carbon\CarbonInterface;

/**
 * Client and staff activity, merged per thread, from every channel at once.
 *
 * Portal messages and mailbox threads answer the same question — a client said
 * something, how long until someone answered — so both are folded into one
 * shape here and measured by one rule:
 *
 *   the clock starts on a client's *first* unanswered message and stops on the
 *   next staff reply.
 *
 * Starting it on the first rather than the latest message is what stops a
 * client who sends three follow-ups in a row from looking like three fast
 * responses; the wait is one wait, measured from when they first asked.
 */
final class Timelines
{
    private const CLIENT = 'client';

    private const STAFF = 'staff';

    /** @var array<string, list<array{actor: string, at: CarbonInterface, client: ?string, seq: int}>> */
    private array $threads = [];

    private int $seq = 0;

    public function addClient(string $thread, CarbonInterface $at, string $clientKey): void
    {
        $this->threads[$thread][] = ['actor' => self::CLIENT, 'at' => $at, 'client' => $clientKey, 'seq' => $this->seq++];
    }

    public function addStaff(string $thread, CarbonInterface $at): void
    {
        $this->threads[$thread][] = ['actor' => self::STAFF, 'at' => $at, 'client' => null, 'seq' => $this->seq++];
    }

    public function isEmpty(): bool
    {
        return $this->threads === [];
    }

    /**
     * Every completed wait: when the client asked, and how long they waited.
     *
     * @return list<array{askedAt: CarbonInterface, seconds: int}>
     */
    public function responsePairs(): array
    {
        $pairs = [];

        foreach ($this->threads as $events) {
            $askedAt = null;

            foreach ($this->ordered($events) as $event) {
                if ($event['actor'] === self::CLIENT) {
                    $askedAt ??= $event['at'];

                    continue;
                }

                if ($askedAt !== null) {
                    // Carbon returns a float here; seconds is the resolution
                    // any of this is meaningful at.
                    $pairs[] = ['askedAt' => $askedAt, 'seconds' => (int) $askedAt->diffInSeconds($event['at'])];
                    $askedAt = null;
                }
            }
        }

        return $pairs;
    }

    /**
     * Clients whose last word in a thread is still hanging, and how long each
     * has been waiting. A client waiting in several threads is reported once,
     * at their longest wait — the dashboard counts people, not tabs.
     *
     * @return array<string, int> client key => longest wait in seconds
     */
    public function awaiting(CarbonInterface $now): array
    {
        $waits = [];

        foreach ($this->threads as $events) {
            $ordered = $this->ordered($events);
            $last = end($ordered);

            if ($last === false || $last['actor'] !== self::CLIENT) {
                continue;
            }

            // Measure from when they first asked, not their latest nudge.
            $askedAt = $last['at'];
            foreach (array_reverse($ordered) as $event) {
                if ($event['actor'] !== self::CLIENT) {
                    break;
                }
                $askedAt = $event['at'];
            }

            $key = $last['client'];
            $seconds = (int) $askedAt->diffInSeconds($now);
            $waits[$key] = max($waits[$key] ?? 0, $seconds);
        }

        return $waits;
    }

    /**
     * Chronological, with insertion order breaking ties — two messages sharing
     * a timestamp must stay in the order they were sent, or a reply can sort
     * ahead of the question it answers and register as a zero-second response.
     *
     * @param  list<array{actor: string, at: CarbonInterface, client: ?string, seq: int}>  $events
     * @return list<array{actor: string, at: CarbonInterface, client: ?string, seq: int}>
     */
    private function ordered(array $events): array
    {
        usort($events, function (array $a, array $b) {
            return [$a['at']->getTimestamp(), $a['seq']] <=> [$b['at']->getTimestamp(), $b['seq']];
        });

        return $events;
    }
}
