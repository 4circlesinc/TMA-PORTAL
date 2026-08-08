<?php

namespace App\Observers;

use App\Support\Realtime\Live;
use Illuminate\Database\Eloquent\Model;

/**
 * Client and company changes, told to staff.
 *
 * On the models rather than ClientsController because the directory is written
 * from several directions — the client hub, onboarding, invitation acceptance,
 * company membership and staff assignment all move rows in here.
 *
 * Staff-only reach: the client directory is staff tooling, and a client has no
 * business being told that another client's record changed. The signal names
 * no record either way ({@see \App\Events\PortalDataChanged}), and each tab
 * refetches through /portal/clients, which applies its own visibility rules.
 */
class ClientDirectoryObserver
{
    public function created(Model $model): void
    {
        $this->signal();
    }

    public function updated(Model $model): void
    {
        $this->signal();
    }

    public function deleted(Model $model): void
    {
        $this->signal();
    }

    public function restored(Model $model): void
    {
        $this->signal();
    }

    private function signal(): void
    {
        if (app()->runningUnitTests()) {
            return;
        }

        Live::staff(Live::CLIENTS);
    }
}
