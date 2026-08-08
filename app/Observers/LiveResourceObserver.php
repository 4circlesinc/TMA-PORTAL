<?php

namespace App\Observers;

use App\Support\Realtime\Live;
use Illuminate\Database\Eloquent\Model;

/**
 * Shared body for the models whose only realtime need is "tell the open tables
 * to refetch": created/updated/deleted/restored → one signal.
 *
 * Subclassed rather than configured through a constructor because
 * Model::observe() registers an observer by *class name* and resolves it from
 * the container when an event fires — an instance passed in is discarded, and
 * a constructor argument the container cannot resolve throws
 * BindingResolutionException on the first write. Each subclass is a few lines
 * and the container can build it.
 *
 * The models needing more than this (files, users, the client directory) keep
 * their own observers, where the extra reach lives.
 *
 * @see Live for why the signal names no record.
 */
abstract class LiveResourceObserver
{
    /** One of the Live::* resource names. */
    abstract protected function resource(): string;

    /**
     * Also tell this record's owner, for resources a client may hold that the
     * staff-wide channel does not reach. Null where there is no such column.
     */
    protected function ownerColumn(): ?string
    {
        return null;
    }

    public function created(Model $model): void
    {
        $this->signal($model);
    }

    public function updated(Model $model): void
    {
        $this->signal($model);
    }

    public function deleted(Model $model): void
    {
        $this->signal($model);
    }

    public function restored(Model $model): void
    {
        $this->signal($model);
    }

    private function signal(Model $model): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        Live::staff($this->resource());

        $column = $this->ownerColumn();

        // getAttribute rather than a property so a model that simply has no
        // such column (a signature recipient, say) yields null and is skipped
        // by Live::user, instead of needing its own subclass.
        if ($column !== null) {
            Live::user($this->resource(), $model->getAttribute($column));
        }
    }
}
