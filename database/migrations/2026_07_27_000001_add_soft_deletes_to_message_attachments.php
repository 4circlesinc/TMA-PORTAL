<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Message files enter the admin Recycle Bin on delete instead of vanishing.
 * Staged discards and message deletes soft-delete the attachment row and keep
 * the bytes until an administrator restores or permanently purges them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->softDeletes();
            $table->foreignId('deleted_by')->nullable()->after('deleted_at')
                ->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('message_attachments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('deleted_by');
            $table->dropSoftDeletes();
        });
    }
};
