<?php

use Database\Seeders\CipDecisionTemplateSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * §23 — one Granted letter and one Denied letter per investment type.
 *
 * The ten rows are the whole set. Administrators rewrite the copy; they do
 * not add an eleventh route or delete Real Estate. Re-seeding uses
 * firstOrCreate so a letter the firm has already reworded is left alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_decision_templates', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('investment_type', 64);
            $table->string('decision', 16);
            $table->string('title', 191);
            $table->text('body');
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['investment_type', 'decision']);
        });

        (new CipDecisionTemplateSeeder)->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_decision_templates');
    }
};
