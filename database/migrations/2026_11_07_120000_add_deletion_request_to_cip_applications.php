<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Somebody asking an administrator to delete a filed application.
 *
 * A draft is its creator's to delete. Once filed, an application is the
 * firm's record: an administrator deletes it, and staff and the provider
 * side ask. The same shape as the appeal request: at most one open request
 * per file (asking again replaces the reason, it does not queue), and the
 * answer is the deletion itself or a decline that clears these columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->timestamp('deletion_requested_at')->nullable();
            $table->foreignId('deletion_requested_by')->nullable()
                ->constrained('users')->nullOnDelete();
            $table->text('deletion_request_reason')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('deletion_requested_by');
            $table->dropColumn(['deletion_requested_at', 'deletion_request_reason']);
        });
    }
};
