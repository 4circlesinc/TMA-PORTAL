<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Artisan;

/**
 * Move the firm's SharePoint libraries off one partner's name.
 *
 * The sync filed everything under the connection's `created_by`, so the four
 * site libraries — 30,524 files and 5,009 folders of citizenship, advisory and
 * post-approval documents — were all owned by the administrator who set the
 * sync up. The Owner column read as a wall of one person's name for files
 * nobody thought of as theirs.
 *
 * The command does the work and is the thing to re-run by hand; this only
 * makes it happen once on deploy. It touches no OneDrive content and nothing
 * created in the portal — see the command for why.
 */
return new class extends Migration
{
    public function up(): void
    {
        Artisan::call('files:reassign-system-owner');
    }

    public function down(): void
    {
        /*
         * Not reversed. Every affected row had the same previous owner, so this
         * *could* hand them back — but doing so would recreate the misfiling
         * this exists to correct, and the sync no longer produces it. Set
         * PORTAL_SYSTEM_ACCOUNT_EMAIL to a different account and re-run
         * `files:reassign-system-owner` to move them somewhere else instead.
         */
    }
};
