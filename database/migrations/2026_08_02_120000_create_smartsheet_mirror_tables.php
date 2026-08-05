<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Smartsheet mirror — the raw landing zone for the CBI migration.
     *
     * The firm is leaving Smartsheet, so this is a one-way inbound sync: the
     * portal never writes back. Sheets land here verbatim (columns, rows,
     * cells, attachments metadata, discussion comments) and a separate mapper
     * turns tracker rows into CBI applications. Keeping the two layers apart
     * means the CBI schema can change without ever re-walking the API — the
     * mapper just re-runs against this mirror.
     *
     * Remote identifiers are always `remote_id` (Smartsheet's 15-digit ids fit
     * a signed bigint); `sheet_id` is always our own FK to smartsheet_sheets.
     */
    public function up(): void
    {
        Schema::create('smartsheet_sheets', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('remote_id')->unique();
            $table->string('name', 512);
            $table->string('permalink', 512)->nullable();

            // Workspace folder path, e.g. "APPLICATION ASSESSMENTS/GALAXY".
            // Classification derives from it: which sheets are master trackers,
            // which are per-applicant assessments, which are closed archives.
            $table->string('folder_path', 1024)->default('');
            // master_tracker | closed | assessment | pending_review |
            // submission | post_approval | other
            $table->string('category', 24)->default('other');

            /*
             * Smartsheet bumps `version` on any change, readable via a
             * one-call endpoint. synced_version records where the last
             * COMPLETE pass got to — equal versions mean the whole sheet
             * fetch can be skipped, which is what keeps a ~300-sheet
             * workspace inside the 300 req/min budget.
             */
            $table->unsignedBigInteger('version')->default(0);
            $table->unsignedBigInteger('synced_version')->nullable();

            $table->unsignedInteger('row_count')->default(0);
            $table->timestamp('created_at_remote')->nullable();
            $table->timestamp('modified_at_remote')->nullable();

            // idle | syncing | error | gone (deleted remotely)
            $table->string('status', 16)->default('idle');
            $table->boolean('sync_enabled')->default(true);
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->text('last_error')->nullable();
            $table->unsignedInteger('error_count')->default(0);

            // Assessment sheets are one-per-applicant; once matched, the
            // sheet's checklist hangs off that application.
            $table->foreignId('cbi_application_id')->nullable();
            $table->string('match_confidence', 16)->nullable(); // exact | fuzzy | manual

            $table->timestamps();
            $table->index(['category', 'sync_enabled']);
        });

        Schema::create('smartsheet_columns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('remote_id');
            $table->string('title', 512);
            $table->string('type', 32);
            $table->json('options')->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->boolean('is_primary')->default(false);
            $table->timestamps();

            $table->unique(['sheet_id', 'remote_id']);
        });

        Schema::create('smartsheet_rows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('remote_id');
            $table->unsignedInteger('row_number')->default(0);
            // Rows nest (assessment checklists indent); order + parent are
            // meaning, not decoration — losing them flattens every checklist.
            $table->unsignedBigInteger('parent_remote_id')->nullable();

            /*
             * Sparse map of columnRemoteId => {v: value, d: displayValue}.
             * Only ~40 of 210 cells hold values on a typical tracker row, so
             * a JSON map beats 210 columns; the mapper resolves titles
             * through smartsheet_columns at read time, which is also what
             * makes a renamed column a config fix instead of a data fix.
             */
            $table->json('cells');

            $table->string('permalink', 512)->nullable();
            $table->timestamp('created_at_remote')->nullable();
            $table->timestamp('modified_at_remote')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->unique(['sheet_id', 'remote_id']);
            $table->index(['sheet_id', 'modified_at_remote']);
        });

        Schema::create('smartsheet_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('remote_id')->unique();
            $table->string('parent_type', 16)->default('ROW'); // ROW | SHEET | COMMENT
            $table->unsignedBigInteger('parent_remote_id')->nullable();
            $table->string('name', 512);
            $table->string('mime_type', 191)->nullable();
            $table->string('attachment_type', 24)->nullable(); // FILE | LINK | ...
            $table->unsignedBigInteger('size_kb')->nullable();
            $table->string('created_by', 320)->nullable();
            $table->timestamp('created_at_remote')->nullable();

            /*
             * Download URLs from Smartsheet are short-lived S3 links, so the
             * portal fetches a fresh one per download. When the retirement
             * phase mirrors binaries into the File Library, the file lands
             * here — null means "still fetched on demand from Smartsheet".
             */
            $table->foreignId('file_id')->nullable()->constrained('files')->nullOnDelete();

            $table->timestamps();
            $table->index(['sheet_id', 'parent_remote_id']);
        });

        Schema::create('smartsheet_discussions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('remote_id')->unique();
            $table->string('parent_type', 16)->default('ROW'); // ROW | SHEET
            $table->unsignedBigInteger('parent_remote_id')->nullable();
            $table->string('title', 512)->nullable();
            $table->unsignedInteger('comment_count')->default(0);
            $table->string('created_by', 320)->nullable();
            $table->timestamp('last_commented_at')->nullable();
            $table->timestamps();

            $table->index(['sheet_id', 'parent_remote_id']);
        });

        Schema::create('smartsheet_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('discussion_id')->constrained('smartsheet_discussions')->cascadeOnDelete();
            $table->foreignId('sheet_id')->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->unsignedBigInteger('remote_id')->unique();
            $table->text('text');
            $table->string('created_by_name', 191)->nullable();
            $table->string('created_by_email', 320)->nullable();
            $table->timestamp('created_at_remote')->nullable();
            $table->timestamp('modified_at_remote')->nullable();
            $table->timestamps();
        });

        Schema::create('smartsheet_sync_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sheet_id')->nullable()->constrained('smartsheet_sheets')->cascadeOnDelete();
            $table->uuid('run_id')->nullable();
            $table->string('action', 40);
            $table->string('level', 8)->default('info'); // info | warning | error
            $table->text('detail')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['sheet_id', 'created_at']);
            $table->index(['run_id']);
            $table->index('level');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('smartsheet_sync_logs');
        Schema::dropIfExists('smartsheet_comments');
        Schema::dropIfExists('smartsheet_discussions');
        Schema::dropIfExists('smartsheet_attachments');
        Schema::dropIfExists('smartsheet_rows');
        Schema::dropIfExists('smartsheet_columns');
        Schema::dropIfExists('smartsheet_sheets');
    }
};
