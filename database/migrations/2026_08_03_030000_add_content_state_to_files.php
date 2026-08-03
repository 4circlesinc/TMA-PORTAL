<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Whether a file's BYTES are here yet, as opposed to its record.
     *
     * The SharePoint import used to download every file's content inline, then
     * push it to R2, one file at a time, inside the delta walk. For a library
     * of ~6,000 items averaging 1.8 MB that is over 3 GB moved twice — hours of
     * wall clock, and nothing in the library was visible until it finished.
     *
     * Importing the metadata alone takes a handful of delta pages, so the whole
     * library can be browsable in minutes. `pending` marks a file whose bytes
     * still live only in SharePoint; the first person to open or download it
     * materialises it, and a warm-up command can do the rest in the background.
     *
     * Null means "the bytes are here", which is every file that already
     * existed and every file uploaded through the portal.
     */
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->string('content_state', 16)->nullable()->after('checksum');
        });

        Schema::table('file_versions', function (Blueprint $table) {
            $table->string('content_state', 16)->nullable()->after('checksum');
        });

        // Finding what still needs warming must not scan the whole library.
        Schema::table('files', function (Blueprint $table) {
            $table->index('content_state');
        });

        /*
         * A file recorded by reference has nowhere to point yet.
         *
         * Both columns were NOT NULL because every file used to arrive with its
         * bytes already in hand. A pending import has neither until someone
         * opens it, and inserting one threw a constraint violation that the
         * per-item error handler swallowed as "item failed" — the walk looked
         * like it was running while importing nothing at all.
         */
        Schema::table('files', function (Blueprint $table) {
            $table->string('disk', 32)->nullable()->default(null)->change();
            $table->string('storage_path')->nullable()->change();
        });
        Schema::table('file_versions', function (Blueprint $table) {
            $table->string('disk', 32)->nullable()->default(null)->change();
            $table->string('storage_path')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropIndex(['content_state']);
            $table->dropColumn('content_state');
        });
        Schema::table('file_versions', function (Blueprint $table) {
            $table->dropColumn('content_state');
        });
        // Deliberately not restoring NOT NULL: rows recorded by reference
        // would make it fail, and a down() that cannot run is worse than one
        // that leaves a column more permissive than it found it.
    }
};
