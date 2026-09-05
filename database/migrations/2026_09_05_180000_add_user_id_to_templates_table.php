<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Compose email templates are no longer firm-only.
 *
 * `user_id` null is a default every mailbox can start from (administrators
 * publish those). A filled `user_id` is that person's own template. Existing
 * compose-email rows stay firm defaults.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            $table->foreignId('user_id')
                ->nullable()
                ->after('updated_by')
                ->constrained('users')
                ->cascadeOnDelete();
            $table->index(['kind', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::table('templates', function (Blueprint $table) {
            $table->dropIndex(['kind', 'user_id']);
            $table->dropConstrainedForeignId('user_id');
        });
    }
};
