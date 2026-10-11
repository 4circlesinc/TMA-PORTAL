<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A person's post-approval status joins the application's own lane.
 *
 * Until now each person wore a placeholder vocabulary (Not started,
 * Documents pending, Processing …) that nothing but a hand ever moved, so
 * a file standing at Approved showed its main applicant as Not started.
 * From here a person's status is one of the lane's own statuses and is
 * read off the application, their documents and the steps recorded for
 * them alone; see {@see \App\Support\Cip\PersonStatus}.
 *
 * Three columns carry what cannot be derived:
 *
 *  - `post_approval_dates`: the dated steps recorded for this person on
 *    their own (NIC and passport), which is what lets one member of a
 *    family stand ahead of the rest.
 *  - `post_approval_apart`: an outcome of their own, Denied or Closed,
 *    after which they stop following the application and their documents
 *    stop holding it.
 *  - `post_approval_missed`: the packs the application handed over while
 *    they stood apart with their papers for it not accepted. Somebody who
 *    missed one cannot simply be put back in step.
 *
 * Only the schema and three plain updates live here. Reading every file's
 * checklist to put its people on their real step is the next migration's
 * work, outside this one's transaction: on Postgres this whole method runs
 * in one, with the table locked from the ALTER on, and that is no place to
 * walk every application.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->json('post_approval_dates')->nullable()->after('post_approval_status');
            $table->string('post_approval_apart', 16)->nullable()->after('post_approval_dates');
            $table->string('post_approval_missed', 32)->nullable()->after('post_approval_apart');
        });

        /*
         * The two old outcomes somebody chose by hand are kept as what they
         * were: this person, apart from the rest of the file. Every other
         * old value said nothing the application and the documents do not
         * say better, so it is cleared; a cleared row reads as the step its
         * application is on until the next migration settles it.
         */
        DB::table('cip_people')
            ->where('post_approval_status', 'denied')
            ->update([
                'post_approval_status' => 'post_denied',
                'post_approval_apart' => 'denied',
            ]);

        DB::table('cip_people')
            ->where('post_approval_status', 'closed')
            ->whereIn('application_id', DB::table('cip_applications')
                ->where('status', '!=', 'closed')
                ->select('id'))
            ->update(['post_approval_apart' => 'closed']);

        DB::table('cip_people')
            ->whereNull('post_approval_apart')
            ->whereNotNull('post_approval_status')
            ->update(['post_approval_status' => null]);
    }

    /**
     * Back to what the release before this one can read.
     *
     * It knew `denied` and `closed` as a person's own outcomes and nothing
     * of the lane's statuses, so those two are handed back as they were and
     * every lane value is cleared (it drew a cleared row as Not started).
     * Without this a rollback would show every individually denied person
     * as Not started, and migrating up again would lose them for good.
     */
    public function down(): void
    {
        DB::table('cip_people')
            ->where('post_approval_apart', 'denied')
            ->update(['post_approval_status' => 'denied']);

        DB::table('cip_people')
            ->where('post_approval_apart', 'closed')
            ->update(['post_approval_status' => 'closed']);

        DB::table('cip_people')
            ->whereNull('post_approval_apart')
            ->whereNotNull('post_approval_status')
            ->update(['post_approval_status' => null]);

        Schema::table('cip_people', function (Blueprint $table) {
            $table->dropColumn(['post_approval_dates', 'post_approval_apart', 'post_approval_missed']);
        });
    }
};
