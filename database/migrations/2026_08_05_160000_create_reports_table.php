<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Account reports — Account settings > Account and Reporting > Reporting.
 *
 * The page used to keep its "reports" in localStorage: a name, a type and a
 * date, with no numbers behind any of them, gone the moment the browser was
 * cleared. A report row here is the *request* (what to measure, over which
 * window, how often) and `data` is the answer, computed by
 * {@see App\Support\Reports\ReportBuilder} from the tables the portal already
 * writes — sign-ins, file activity, messages, storage.
 *
 * `frequency` is what separates the two tabs on the page: null is a one-off
 * that keeps the numbers it was generated with, anything else is recurring and
 * `next_run_at` says when the scheduler should recompute it (reports:run).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reports', function (Blueprint $table) {
            $table->id();
            // Public identifier: the browser addresses reports by this.
            $table->ulid('uid')->unique();

            $table->string('name');
            $table->string('type', 24);          // usage | access | messaging | storage
            $table->string('range_key', 16);     // last_7 | last_30 | last_90 | custom
            $table->date('starts_on');
            $table->date('ends_on');

            // null = one-off. weekly | monthly otherwise.
            $table->string('frequency', 16)->nullable();
            $table->timestamp('next_run_at')->nullable();
            $table->timestamp('generated_at')->nullable();

            $table->string('status', 16)->default('pending'); // pending | ready | failed
            $table->jsonb('data')->nullable();
            $table->text('error')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['frequency', 'next_run_at']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reports');
    }
};
