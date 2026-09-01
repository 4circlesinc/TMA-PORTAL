<?php

use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * The firm's official pre-approval checklists, replacing the placeholders.
 *
 * "Preparing Your Files for Submission" (updated 28.05.2025) arrived, and its
 * Application Folders lists — transcribed in
 * {@see \App\Support\Cip\ApplicationRequirements} — are the standards the
 * considered-default set was standing in for. This writes the guide's wording,
 * order and required flags over that placeholder set, adds everything it asks
 * for that the placeholders did not (the SL forms, the affidavits, the bank
 * reference and net worth, the credentials series, the sponsor's own list),
 * and retires what it does not (the medical certificate among them) without
 * touching a document anyone has filed. The post-approval flags are then
 * re-settled so the marriage, divorce and name-change papers carry forward
 * from the principal applicant's folder, where the guide files them.
 */
return new class extends Migration
{
    public function up(): void
    {
        $seeder = new CipDocumentRequirementSeeder;
        $seeder->installOfficialPreApproval();
        $seeder->syncPostApproval();
    }

    public function down(): void
    {
        // Deliberately nothing, for the same reason the placeholder seed
        // migration rolls back to nothing: by now the firm may have edited
        // these rows, and documents are filed against them.
    }
};
