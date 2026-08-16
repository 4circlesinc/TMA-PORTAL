<?php

use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Fill the requirements table the moment it exists.
 *
 * The checklist is the module: an application whose people owe nothing has
 * nothing to review, so an empty table on the day of the deploy would read as
 * a broken feature rather than one waiting to be configured. The firm has not
 * yet given us their official document standards, so what lands here is the
 * considered default set in {@see CipDocumentRequirementSeeder}, which they
 * then edit in the portal.
 *
 * The seeder is idempotent on applicant_type + key, so running `db:seed` later
 * restores anything that was deleted without touching what the firm has
 * reworded, reordered or made optional.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new CipDocumentRequirementSeeder)->run();
    }

    public function down(): void
    {
        // Deliberately nothing. By the time anyone rolls this back the firm may
        // have spent an afternoon rewording these, and a rollback of a data
        // seed is no reason to throw that away — nor to strand the documents
        // filed against them. The migration that creates the table drops it,
        // which is the only disposal these rows should ever get.
    }
};
