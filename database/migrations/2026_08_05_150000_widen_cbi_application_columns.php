<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The original widths assumed picklist-sized values, but the trackers'
     * cells are free-typed: statuses carry annotations, "submitted by" cells
     * hold several names, action_needed holds sentences. An overwidth value
     * doesn't just truncate — it aborts the whole bulk upsert chunk it rides
     * in with. Widen to 191 across the board; Mapper::FIELD_LIMITS mirrors
     * these widths as the second line of defence.
     */
    public function up(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            foreach (['status', 'application_review', 'progress', 'submitted_by',
                'verified_by', 'investment_option', 'application_type', 'action_needed'] as $column) {
                $table->string($column, 191)->nullable()->change();
            }
        });
    }

    public function down(): void
    {
        Schema::table('cbi_applications', function (Blueprint $table) {
            foreach (['status', 'application_review', 'progress', 'submitted_by',
                'verified_by', 'investment_option', 'application_type'] as $column) {
                $table->string($column, 64)->nullable()->change();
            }
            $table->string('action_needed', 16)->nullable()->change();
        });
    }
};
