<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A slot's requirement row, and where it has got to (§12).
 *
 * The slot keeps its `type` slug. That slug is what identifies the requirement
 * when there is no template row to point at — an application imported from the
 * mirror, or a requirement retired since the file was opened — so
 * `requirement_id` is the join when one exists rather than the identity.
 * Retiring a template nulls the join and leaves the answer where it is.
 *
 * Status is per document, not per application. Each slot travels its own short
 * lifecycle — pending upload, application review, update required, ready for
 * submission — and a reviewer's queue is exactly "every slot in this state
 * across every file", which is why it is a stored, indexed column rather than
 * something inferred from file_id and a version count. Inferring it could not
 * express "update required" at all: a slot awaiting a correction holds a file
 * and is not waiting for a first upload.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_documents', function (Blueprint $table) {
            $table->foreignId('requirement_id')->nullable()->after('person_id')
                ->constrained('cip_document_requirements')->nullOnDelete();

            $table->string('status', 32)->default('pending_upload')->after('required')->index();

            // When it last moved. "Waiting since" reads from here rather than
            // updated_at, which a rename or a re-upload would reset.
            $table->timestamp('status_changed_at')->nullable()->after('status');
        });

        // Slots filled before this migration are not waiting for an upload,
        // they are waiting for a reviewer. Left at the default they would sit
        // in the wrong queue and be invisible to the first review.
        DB::table('cip_documents')->whereNotNull('file_id')->update([
            'status' => 'application_review',
            'status_changed_at' => DB::raw('uploaded_at'),
        ]);
    }

    public function down(): void
    {
        Schema::table('cip_documents', function (Blueprint $table) {
            // The index goes first: SQLite refuses to drop a column any index
            // still names, and it has to be gone on Postgres too.
            $table->dropIndex(['status']);
            $table->dropConstrainedForeignId('requirement_id');
            $table->dropColumn(['status', 'status_changed_at']);
        });
    }
};
