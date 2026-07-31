<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Staff assigned to a whole company rather than to one contact inside it.
 *
 * Mirrors `client_assignments` deliberately — same roles, same levels, same
 * "ends rather than deletes" rule — because it answers the same question one
 * level up. What it adds is reach: `applies_to_clients` decides whether the
 * assignment also covers the people beneath the company.
 *
 * That reach is stored, not inferred, and it is why the spec insists an
 * administrator is shown what will happen before it does. `company_only` is the
 * default for exactly that reason: the broad option has to be chosen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('company_staff_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('company_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // Same vocabulary as ClientAssignment::ROLES.
            $table->string('role', 32)->default('general');
            $table->string('permission_level', 24)->default('view_files');
            $table->boolean('is_primary')->default(false);

            /*
             * How far the assignment reaches:
             *   company_only    — the company record and its own files
             *   existing        — plus every client under it at the time
             *   existing_future — plus every client under it, now and later
             */
            $table->string('applies_to_clients', 24)->default('company_only');

            $table->string('status', 16)->default('active');
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->foreignId('ended_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();

            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['company_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        // One live assignment per person per company; ended ones may stack up.
        DB::statement(
            "CREATE UNIQUE INDEX company_staff_active_unique
             ON company_staff_assignments (company_id, user_id) WHERE status = 'active'"
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS company_staff_active_unique');
        Schema::dropIfExists('company_staff_assignments');
    }
};
