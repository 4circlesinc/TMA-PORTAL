<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The client-document review state, on the file.
 *
 * Nullable on purpose: most files in the library are not client documents and
 * never enter a review. A default of "pending review" would put every logo,
 * template and internal note into a queue nobody asked for, and the badge is
 * only meaningful because its absence means something.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->string('review_status', 32)->nullable()->after('content_state');
            // Why it was rejected. Kept for every state, not just rejection, so
            // an approval can carry a note too — and so a later rejection does
            // not silently inherit the previous reason.
            $table->text('review_note')->nullable()->after('review_status');
            $table->foreignId('reviewed_by')->nullable()->after('review_note')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable()->after('reviewed_by');

            // "Show me everything still waiting" is the whole point of the
            // feature, and it is a filter on this column across a folder.
            $table->index(['review_status', 'folder_id']);
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropIndex(['review_status', 'folder_id']);
            $table->dropConstrainedForeignId('reviewed_by');
            $table->dropColumn(['review_status', 'review_note', 'reviewed_at']);
        });
    }
};
