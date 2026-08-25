<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Give folders that sit under a client the client they sit under.
 *
 * `folders.client_id` was written once, at creation, from whatever the parent
 * held at that moment. A CIP tree built before its client row existed, or a
 * folder found by name rather than made, kept a NULL nobody went back for.
 *
 * That is invisible until something reads it, and two things do: the CIP
 * attention dot and the unread-comment count both find a client's documents
 * by joining `folders.client_id`. On this database it hid every one of the 21
 * comments on Chen Wei's Main Applicant folder, including a thread naming a
 * reader who therefore never saw it.
 *
 * {@see \App\Support\Cip\Tree::stampClient} stops new trees drifting. This
 * repairs the ones already standing.
 */
return new class extends Migration
{
    public function up(): void
    {
        /*
         * A level at a time, parent to child, until nothing moves.
         *
         * A recursive CTE would do it in one statement, but UPDATE ... FROM a
         * CTE is spelled differently on Postgres and SQLite and this has to
         * run on both. Trees are shallow and the loop stops as soon as a pass
         * changes nothing, so the cost is one query per level of depth.
         *
         * Trashed folders are included deliberately: a folder restored from
         * the recycle bin should come back already in step, not carrying the
         * same silence back with it.
         */
        for ($depth = 0; $depth < 32; $depth++) {
            $filled = DB::table('folders')
                ->whereNull('client_id')
                ->whereIn('parent_id', fn ($q) => $q
                    ->select('id')
                    ->from('folders')
                    ->whereNotNull('client_id'))
                ->update([
                    'client_id' => DB::raw(
                        '(select p.client_id from folders p where p.id = folders.parent_id)'
                    ),
                ]);

            if ($filled === 0) {
                break;
            }
        }
    }

    public function down(): void
    {
        // Which of these were NULL before is not recorded, and guessing would
        // blank folders that were always correct. Nothing to undo.
    }
};
