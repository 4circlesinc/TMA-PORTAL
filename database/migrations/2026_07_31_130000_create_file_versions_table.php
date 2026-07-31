<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Every stored revision of a file, including the one that is current.
     *
     * `files` stays the pointer to the current bytes rather than becoming a
     * shell that references a version row. That keeps every existing path —
     * download, preview, thumbnails, ZIP, sharing — working untouched, and it
     * means a bug in versioning can never make a file unreadable. The trade is
     * that files.storage_path duplicates the current version's; App\Support\
     * Files\Versions is the only writer of both, so they cannot drift.
     *
     * Bytes are never shared between version rows: one version owns exactly one
     * blob. Restoring copies the bytes rather than pointing two rows at one
     * path, so purging a version can never blank another one.
     */
    public function up(): void
    {
        Schema::create('file_versions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('file_id')->constrained('files')->cascadeOnDelete();
            $table->unsignedInteger('version_number');

            // The stored bytes for THIS revision.
            $table->string('disk', 32)->default('local');
            $table->string('storage_path');
            $table->unsignedBigInteger('size')->default(0);
            $table->string('checksum', 64)->nullable();
            $table->string('mime_type', 191)->nullable();
            $table->string('extension', 32)->nullable();

            // Who made it, and why. The note is the "reason this version
            // exists" the spec asks to be recorded.
            //
            // nullOnDelete, deliberately NOT cascade: files.owner_id and
            // uploaded_by are cascadeOnDelete and that has already been a trap
            // here (deleting a user could destroy content). Version history is
            // an audit record — losing it because someone left is wrong.
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('note')->nullable();

            // Set when this version was produced by restoring an older one, so
            // the history can say "restored from v2" rather than looking like
            // an ordinary upload.
            $table->foreignId('restored_from_id')->nullable()
                ->constrained('file_versions')->nullOnDelete();

            $table->boolean('is_current')->default(false);

            // Populated by the approval workflow (Phase 4) and by SharePoint
            // sync (Phase 10). Null until then, and not rendered while null.
            $table->string('approval_status', 32)->nullable();
            $table->string('graph_version_id', 128)->nullable();

            $table->timestamps();

            $table->unique(['file_id', 'version_number']);
            $table->index(['file_id', 'is_current']);
            $table->index(['file_id', 'created_at']);
        });

        Schema::table('files', function (Blueprint $table) {
            // Denormalised so the files table can show a version column without
            // a query per row. Maintained only by App\Support\Files\Versions.
            $table->unsignedInteger('version_number')->default(1)->after('checksum');
        });

        Schema::table('upload_sessions', function (Blueprint $table) {
            // A chunked upload can target an existing file, making it that
            // file's next version instead of a new file. Without this, files
            // over the direct-upload size could never get a new version.
            $table->foreignId('version_of_file_id')->nullable()->after('folder_id')
                ->constrained('files')->cascadeOnDelete();
            // The "why" is captured when the upload starts, so it survives the
            // minutes a 2 GB transfer takes.
            $table->text('version_note')->nullable()->after('version_of_file_id');
        });

        // Every file that already exists is version 1 of itself. Without this
        // backfill, history would start empty and the current bytes would sit
        // outside the version list they belong to.
        $now = now();
        DB::table('files')->orderBy('id')->chunkById(200, function ($files) use ($now) {
            $rows = [];
            foreach ($files as $file) {
                $rows[] = [
                    'uuid' => (string) Str::uuid(),
                    'file_id' => $file->id,
                    'version_number' => 1,
                    'disk' => $file->disk,
                    'storage_path' => $file->storage_path,
                    'size' => $file->size,
                    'checksum' => $file->checksum,
                    'mime_type' => $file->mime_type,
                    'extension' => $file->extension,
                    'uploaded_by' => $file->uploaded_by,
                    'note' => null,
                    'is_current' => true,
                    'created_at' => $file->created_at ?? $now,
                    'updated_at' => $file->updated_at ?? $now,
                ];
            }
            if ($rows) {
                DB::table('file_versions')->insert($rows);
            }
        });
    }

    public function down(): void
    {
        Schema::table('upload_sessions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('version_of_file_id');
            $table->dropColumn('version_note');
        });
        Schema::table('files', function (Blueprint $table) {
            $table->dropColumn('version_number');
        });
        Schema::dropIfExists('file_versions');
    }
};
