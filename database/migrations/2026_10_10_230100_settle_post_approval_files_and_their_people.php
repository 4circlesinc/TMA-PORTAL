<?php

use App\Support\Cip\Settlement;
use Illuminate\Database\Migrations\Migration;

/**
 * Put every post-approval file, and everyone on it, where the rules say
 * they stand, once, as the rules arrive.
 *
 * Two things were left behind by the code this replaces. People wore a
 * vocabulary of their own, cleared by the migration before this one. And
 * a file standing at Approved did not follow its documents at all, so one
 * whose papers were all accepted before today is still sitting at Approved
 * with nothing left to judge that would ever move it: left alone, the
 * table would show APPROVED over a family reading APPLY FOR COR, which is
 * the report this work answers.
 *
 * Not in a transaction. Each file is settled in its own, so one that
 * cannot be read is logged and skipped rather than poisoning the rest, the
 * people table is not held locked while every application is walked, and
 * each application's fresh timestamp is committed as it is written.
 *
 * Idempotent: a second run finds nothing to change. `php artisan
 * cip:settle-people` is the same pass, for any later day it is wanted.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        Settlement::everyPostApprovalFile();
    }

    public function down(): void
    {
        // Nothing to undo: the statuses themselves are handed back by the
        // migration that added their columns.
    }
};
