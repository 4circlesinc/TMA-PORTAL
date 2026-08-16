<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A file request that answers one checklist slot.
 *
 * Request Files already hands a link to somebody with no portal account and
 * takes what they send into a destination chosen once, by the requester. This
 * column narrows that destination from a folder to a single document: the
 * upload lands *in the slot* — the same row the checklist, the status and the
 * comment thread hang off — instead of arriving as a loose file that a
 * reviewer would then have to recognise and re-home by hand.
 *
 * Nullable because most requests are not CIP at all; the column is the whole
 * difference between "send me some documents" and "send me this bio page".
 * Null on delete rather than cascade, on the same reasoning as `folder_id`
 * above it: losing the slot must not destroy the record of what was asked for.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('file_requests', function (Blueprint $table) {
            $table->foreignId('document_id')->nullable()->after('folder_id')
                ->constrained('cip_documents')->nullOnDelete();

            // "Has anything been asked for on this slot?" — the checklist asks
            // it once per row it draws.
            $table->index('document_id');
        });
    }

    public function down(): void
    {
        Schema::table('file_requests', function (Blueprint $table) {
            // Dropped before the column: SQLite will not drop a column an
            // index still names.
            $table->dropIndex(['document_id']);
            $table->dropConstrainedForeignId('document_id');
        });
    }
};
