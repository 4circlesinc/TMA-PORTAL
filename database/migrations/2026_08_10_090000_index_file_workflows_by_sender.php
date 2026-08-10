<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Everything I sent, still open."
     *
     * The Workflows page asks this on every load, and the table only had
     * indexes for the two questions the per-file panel asks — by file, and by
     * due date. Without this, one person's outbox is a scan of every request
     * the firm has ever sent.
     */
    public function up(): void
    {
        Schema::table('file_workflows', function (Blueprint $table) {
            $table->index(['created_by', 'status'], 'file_workflows_created_by_status_index');
        });
    }

    public function down(): void
    {
        Schema::table('file_workflows', function (Blueprint $table) {
            $table->dropIndex('file_workflows_created_by_status_index');
        });
    }
};
