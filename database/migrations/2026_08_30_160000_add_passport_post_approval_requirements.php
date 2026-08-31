<?php

use Database\Seeders\CipDocumentRequirementSeeder;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /**
     * Stage 3 passport document requirements (hard-copy originals).
     */
    public function up(): void
    {
        (new CipDocumentRequirementSeeder)->syncPostApproval();
    }

    public function down(): void
    {
        // Catalogue rows stay; an administrator retires them in Settings.
    }
};
