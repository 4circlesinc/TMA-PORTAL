<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The provider side asking for an appeal.
 *
 * A request is not the appeal. Section 22 keeps the lifecycle in staff hands — a
 * service provider may create, edit and upload, but must not move a file
 * through it — so the button on their side records that they asked and tells
 * the firm, and an officer lodges it. Same split as Confirm submission, where
 * the provider freezes the package and the firm records the submission.
 *
 * Kept as columns on the application rather than a table of its own: there is
 * at most one open request per file (a second press is the same request, not a
 * queue), and the moment it is lodged the event log carries the history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->timestamp('appeal_requested_at')->nullable()->after('appeal_submitted_at');
            $table->foreignId('appeal_requested_by')->nullable()->after('appeal_requested_at')
                ->constrained('users')->nullOnDelete();
            $table->text('appeal_request_reason')->nullable()->after('appeal_requested_by');
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('appeal_requested_by');
            $table->dropColumn(['appeal_requested_at', 'appeal_request_reason']);
        });
    }
};
