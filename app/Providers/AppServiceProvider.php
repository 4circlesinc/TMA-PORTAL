<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // App\Listeners\RecordAuthEvent is picked up by Laravel's automatic
        // listener discovery - do not also register it manually, or every
        // auth event gets recorded twice.
    }
}
