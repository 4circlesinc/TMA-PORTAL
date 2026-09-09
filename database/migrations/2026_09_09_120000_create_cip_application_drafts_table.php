<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The intake wizard's work in progress, saved as it is typed.
 *
 * An application is a long form — eight fields per person, a sponsor, up to
 * six dependents — and until now every one of those answers lived in one tab.
 * A closed laptop, a stray Back, a crashed browser and the whole filing was
 * gone. This is where it is kept instead, so the wizard opens on what was
 * being typed rather than on nothing.
 *
 * ONE DRAFT PER PERSON PER PHASE, AND WHY NOT ONE PER SUBMISSION
 *
 * The wizard mints a submission key at open, so keying on it would give a
 * reader a new empty draft every time they pressed Add — which is exactly
 * the resume that would never fire. A reader files one application at a
 * time, and the two phases are two different forms, so the pair is the key
 * and a unique index makes a second draft for the same pair impossible.
 *
 * ANSWERS ONLY, NEVER FILES
 *
 * `answers` holds what was typed. The scans are not here and must not be:
 * uploading a document into a half-finished application would put unreviewed
 * files in a client's folders before anybody filed it, and Status::DRAFT was
 * retired precisely so an unfiled application is not a record. The wizard
 * says plainly which scans have to be chosen again on resume.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cip_application_drafts', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('phase', 32);
            // The typed answers, keyed by the same paths the wizard and the
            // validator use, so resuming is a copy rather than a translation.
            $table->json('answers');
            // How many dependent blocks were on the page. Not derivable from
            // the answers: a dependent whose fields are all still empty is a
            // row the reader added and has not filled in yet.
            $table->unsignedTinyInteger('dependents')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'phase']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_application_drafts');
    }
};
