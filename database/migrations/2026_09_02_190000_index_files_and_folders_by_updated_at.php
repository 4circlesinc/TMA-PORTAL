<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recent is ORDER BY updated_at LIMIT a page. Without this index the
 * listing (and every dashboard widget that asks for it) sequential-scans
 * the files table, which is what 504'd `/portal/files?section=recent`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->index('updated_at');
        });
        Schema::table('folders', function (Blueprint $table) {
            $table->index('updated_at');
        });
    }

    public function down(): void
    {
        Schema::table('files', function (Blueprint $table) {
            $table->dropIndex(['updated_at']);
        });
        Schema::table('folders', function (Blueprint $table) {
            $table->dropIndex(['updated_at']);
        });
    }
};
