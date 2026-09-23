<?php

use App\Support\Cip\AdditionalDocuments;
use App\Models\CipDocument;
use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * One open drop box on every person, for the paper no checklist named.
 *
 * The seeded lists cover what the firm knows to ask for. Everything else — a
 * guardianship order, a translator's note, the letter an officer asked for
 * over the phone — had nowhere to go on the person it belonged to, so it
 * landed in the client-level Additional Documents drawer where it stopped
 * saying whose it was, or it never went up at all.
 *
 * This installs {@see AdditionalDocuments} for all five applicant types on all
 * three lanes. It is optional everywhere, so no file in flight becomes
 * incomplete the moment it appears, and existing slots are untouched.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new CipDocumentRequirementSeeder)->syncAdditionalDocuments();
    }

    /**
     * The template goes; the papers stay.
     *
     * A slot that holds a file is left alone and simply stops being offered —
     * the same bargain {@see \App\Support\Cip\Requirements::retire()} makes.
     * Deleting a filled slot would orphan a document somebody filed.
     */
    public function down(): void
    {
        CipDocument::query()
            ->where('type', AdditionalDocuments::KEY)
            ->whereNull('file_id')
            ->delete();

        \App\Models\CipDocumentRequirement::query()
            ->where('key', AdditionalDocuments::KEY)
            ->update(['active' => false]);
    }
};
