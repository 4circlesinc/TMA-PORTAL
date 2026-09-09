<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The scratch drafts table, retired: a draft IS an application now.
 *
 * It held the intake wizard's unfinished answers as JSON beside the real
 * applications, which meant a half-typed filing was invisible to the firm —
 * nobody could see it in the table, refer to it by number, or pick it up.
 * Drafts are ordinary application rows at Status::DRAFT instead, so they
 * appear with everything else and filing one is a status change.
 *
 * Rows are not migrated. They were partial answers keyed to one reader, days
 * old at most, and inventing numbered applications out of them would put rows
 * in the firm's table that nobody chose to create. Anyone mid-draft retypes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('cip_application_drafts');
    }

    public function down(): void
    {
        Schema::create('cip_application_drafts', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('phase', 32);
            $table->json('answers');
            $table->unsignedTinyInteger('dependents')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'phase']);
        });
    }
};
