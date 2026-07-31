<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Gives a client assignment a *job* as well as a permission level, and stops
 * removals from erasing the record that they happened.
 *
 * Before this an assignment was only "this person may reach these files at this
 * level" — there was no way to say who the account manager was as opposed to
 * the finance contact, and removing someone deleted the row, taking with it any
 * evidence that they had ever looked after the client.
 *
 * Ending an assignment now sets `status = 'ended'` and keeps the row. The
 * unique constraint therefore has to apply only to live assignments, or the
 * same person could never be re-assigned to a client they once left — hence the
 * partial unique index replacing the plain one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('client_assignments', function (Blueprint $table) {
            // account_manager | booking_coordinator | finance | contract_manager
            // | event_coordinator | general
            $table->string('role', 32)->default('general')->after('user_id');
            // active | ended
            $table->string('status', 16)->default('active')->after('is_primary');

            $table->timestamp('starts_at')->nullable()->after('status');
            // A planned finish, for cover and temporary assignments. Access
            // stops on its own once this passes — see ClientAssignment::isLive().
            $table->timestamp('ends_at')->nullable()->after('starts_at');
            // When it actually ended, and who ended it.
            $table->timestamp('ended_at')->nullable()->after('ends_at');
            $table->foreignId('ended_by')->nullable()->after('ended_at')
                ->constrained('users')->nullOnDelete();

            $table->text('notes')->nullable();

            $table->index(['client_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        // Existing rows predate the concept and are all live general assignments.
        DB::table('client_assignments')->update([
            'role' => 'general',
            'status' => 'active',
        ]);

        Schema::table('client_assignments', function (Blueprint $table) {
            $table->dropUnique('client_assignments_client_id_user_id_unique');
        });

        // One live assignment per person per client; ended ones may stack up.
        // Postgres and SQLite both support a partial unique index.
        DB::statement(
            "CREATE UNIQUE INDEX client_assignments_active_unique
             ON client_assignments (client_id, user_id) WHERE status = 'active'"
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS client_assignments_active_unique');

        Schema::table('client_assignments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('ended_by');
            $table->dropColumn(['role', 'status', 'starts_at', 'ends_at', 'ended_at', 'notes']);
            $table->unique(['client_id', 'user_id']);
        });
    }
};
