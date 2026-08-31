<?php

namespace Tests\Feature;

use Illuminate\Database\Console\Migrations\FreshCommand;
use Illuminate\Database\Console\WipeCommand;
use Tests\TestCase;

class DestructiveMigrationGuardTest extends TestCase
{
    public function test_phpunit_can_still_run_migrate_fresh(): void
    {
        $this->artisan('migrate:fresh')->assertSuccessful();
    }

    public function test_migrate_fresh_fails_when_the_command_is_prohibited(): void
    {
        FreshCommand::prohibit(true);

        try {
            $this->artisan('migrate:fresh')->assertFailed();
        } finally {
            FreshCommand::prohibit(false);
        }
    }

    public function test_db_wipe_fails_when_the_command_is_prohibited(): void
    {
        WipeCommand::prohibit(true);

        try {
            $this->artisan('db:wipe')->assertFailed();
        } finally {
            WipeCommand::prohibit(false);
        }
    }
}
