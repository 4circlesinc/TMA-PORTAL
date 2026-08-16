<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The checklist templates (§12): what each kind of applicant owes.
 *
 * Phase 2 opened slots from the constants in {@see \App\Support\Cip\DocumentTypes}
 * because the checklist had to mean the same thing before this table existed.
 * These rows take that over, and `key` is deliberately the same slug: a slot
 * filled at intake keeps answering the same question once the requirement row
 * appears beside it, and nothing has to be re-homed.
 *
 * Requirements are held per applicant *type* rather than per person. The type
 * is worked out from the person — a dependant's age bracket is measured on the
 * application's creation date, never typed in — so widening a checklist is one
 * row here rather than an edit to every file in flight.
 *
 * `active` sits over the soft delete on purpose: retiring a requirement has to
 * stop it appearing on new applications without disturbing the slots already
 * opened against it. Neither flag destroys the row, because a slot points at
 * it and a citizenship file must still be able to say what an upload answered.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_document_requirements', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            // principal_applicant | spouse | dependent_under_16 |
            // dependent_16_over | sponsor
            $table->string('applicant_type', 32)->index();

            // The slug a slot carries. Stable and machine-facing; `label` is
            // the part anybody is allowed to rewrite.
            $table->string('key', 64);
            $table->string('label', 191);

            $table->boolean('required')->default(true);

            // The order a reviewer reads the checklist in. Editorial, not
            // alphabetical: the passport comes before the bank reference
            // because that is the order the file is assembled in.
            $table->integer('sort_order')->default(0);

            $table->boolean('active')->default(true);

            // Shown beside the row when the requirement needs explaining —
            // which page of the passport, whose certificate, certified or not.
            $table->text('help')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // One row per requirement per applicant type: seeding again edits
            // the template rather than adding a second copy of it.
            $table->unique(['applicant_type', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_document_requirements');
    }
};
