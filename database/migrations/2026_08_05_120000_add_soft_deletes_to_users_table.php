<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Deleting a user from Browse employees used to erase the row, and everything
 * keyed to it cascaded away with no way back. Accounts now soft-delete into the
 * admin Recycle Bin, where they can be restored whole or purged for real.
 *
 * `deleted_by` self-references users so the bin can show who removed the
 * account; nullOnDelete keeps that pointer harmless once the remover is purged.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->softDeletes();
            $table->foreignId('deleted_by')->nullable()->after('deleted_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('deleted_by');
            $table->dropSoftDeletes();
        });
    }
};
