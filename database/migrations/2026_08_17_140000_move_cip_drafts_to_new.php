<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Applications are filed as New Applications, not Draft.
 *
 * Rows that were still sitting at `draft` join the New Applications queue —
 * the same place a file lands today — so a chip never still says Draft after
 * the vocabulary moved on. The leftover code stays valid for historical
 * events; nothing new is written into it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('cip_applications')->where('status', 'draft')->update(['status' => 'new']);
    }

    public function down(): void
    {
        // Not reversed: a file that has been New Applications is not a draft
        // again, and inventing which ones were would be guessing.
    }
};
