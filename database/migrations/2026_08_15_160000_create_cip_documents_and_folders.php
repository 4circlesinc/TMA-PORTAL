<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The application's folder tree (§6) and its document slots (§2, §11).
 *
 * Folders are addressed by id, never by name. Client folders rename
 * themselves to follow the client, and a tree keyed on "Main Applicant" would
 * quietly detach the first time anything was renamed — so the application and
 * each person point at their own folder row and the names are free to change.
 *
 * A slot is the question ("this person owes a birth certificate"), not the
 * answer: it exists empty from the moment the person does, and holds a
 * file_id once one is uploaded. That is why the intake uploads are
 * slot-addressed on the first save rather than loose files that Phase 3 would
 * have to find and re-home into a checklist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('folder_id')->nullable()->after('client_id')
                ->constrained('folders')->nullOnDelete();
        });

        Schema::create('cip_documents', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('application_id')->constrained('cip_applications')->cascadeOnDelete();
            $table->foreignId('person_id')->constrained('cip_people')->cascadeOnDelete();

            // The requirement this slot stands for. A slug rather than a
            // foreign key: Phase 3 introduces the requirement templates, and
            // the three intake types have to mean the same thing before and
            // after that table exists.
            $table->string('type', 64);
            $table->string('label', 191);
            $table->boolean('required')->default(true);

            // Null until something is uploaded. Deleting the file empties the
            // slot rather than destroying the requirement.
            $table->foreignId('file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('uploaded_at')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // One slot per requirement per person: uploading again replaces
            // the file (and adds a version), it does not add a second slot.
            $table->unique(['person_id', 'type']);
            $table->index(['application_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cip_documents');

        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('folder_id');
        });
    }
};
