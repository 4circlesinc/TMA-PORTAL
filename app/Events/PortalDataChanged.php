<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * "Something in this resource changed — refetch it."
 *
 * Deliberately carries no row data. The portal's read rules are the most
 * intricate thing in the codebase (FileAccess, CompanyAccess, Role::MATRIX,
 * client isolation, folder permissions, live-only assignments), and a payload
 * carrying rows would mean re-deriving "who may see this" a second time, in a
 * place with none of the tests the HTTP endpoints have. One divergence between
 * the two is a client reading another client's file list.
 *
 * So this is a doorbell, not a delivery. The browser hears the resource name
 * and refetches through the same authorised endpoint it already uses, which
 * means live updates inherit the access rules instead of re-implementing them.
 * The cost is one request per interested, *currently watching* tab.
 *
 * For the same reason the payload never names a record: on a shared channel
 * even an id tells a reader that a thing exists. The resource name is the
 * whole message.
 *
 * High-frequency surfaces (messaging, feed, calls) keep their own precise
 * events — this is for the list-and-table surfaces that used to need F5.
 *
 * Broadcasts immediately rather than through the queue, like every other event
 * here: the portal's worker has a documented habit of falling behind, and a
 * live update that arrives ten minutes late is worse than none.
 */
class PortalDataChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  string  $resource  Logical surface name, e.g. 'files', 'clients'.
     * @param  array<int, Channel>  $channels
     */
    public function __construct(
        public string $resource,
        public array $channels,
    ) {}

    /** @return array<int, Channel> */
    public function broadcastOn(): array
    {
        return $this->channels;
    }

    public function broadcastAs(): string
    {
        return 'data.changed';
    }

    /** @return array<string, string> */
    public function broadcastWith(): array
    {
        return ['resource' => $this->resource];
    }
}
