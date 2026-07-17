<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which staff members are assigned to which clients, and at what level.
     *
     * Assignment is the source of truth for a staff member's access to a
     * client's folder - FileAccess derives an effective folder role from
     * `permission_level`, so removing the row removes the access. This keeps
     * assignment and access in one place rather than duplicating share rows.
     */
    public function up(): void
    {
        Schema::create('client_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('client_id')->constrained('clients')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            // view_only | view_files | contributor | editor | manager | full
            $table->string('permission_level', 24)->default('view_files');
            $table->boolean('is_primary')->default(false);
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['client_id', 'user_id']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('client_assignments');
    }
};
