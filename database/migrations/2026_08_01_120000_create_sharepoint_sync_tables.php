<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * SharePoint synchronisation.
     *
     * Three tables, each doing one job:
     *
     *  - `sharepoint_connections` — one linked document library, and where its
     *    delta cursor has got to. The cursor is what makes this a *connection*
     *    rather than a repeated import: Graph hands back a link that means
     *    "everything since last time", so we never re-walk the library.
     *  - `sharepoint_items` — the mapping between a Graph driveItem and the
     *    portal row that represents it. This is what prevents duplicates: the
     *    same file arriving twice finds its existing mapping and updates it.
     *  - `sharepoint_sync_logs` — what happened, so a failure is diagnosable
     *    after the fact rather than only while it is happening.
     */
    public function up(): void
    {
        Schema::create('sharepoint_connections', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            // Microsoft's identifiers, kept verbatim.
            $table->string('tenant_id', 64)->nullable();
            $table->string('site_id', 512);
            $table->string('site_name')->nullable();
            $table->string('site_url', 512)->nullable();
            $table->string('drive_id', 512);
            $table->string('drive_name')->nullable();

            // The portal folder this library appears as.
            $table->foreignId('folder_id')->nullable()->constrained('folders')->nullOnDelete();

            /*
             * Graph's delta cursor. Opaque and long — never parse it, never
             * truncate it. A null cursor means "never synced", which triggers
             * a full initial walk; anything else is an incremental fetch.
             */
            $table->text('delta_link')->nullable();

            // idle | syncing | error | disconnected
            $table->string('status', 24)->default('idle');
            $table->boolean('sync_enabled')->default(true);
            // in | both — whether portal changes are pushed back.
            $table->string('direction', 8)->default('both');

            $table->timestamp('last_synced_at')->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->text('last_error')->nullable();
            $table->unsignedInteger('error_count')->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['site_id', 'drive_id']);
            $table->index(['sync_enabled', 'status']);
        });

        Schema::create('sharepoint_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('connection_id')->constrained('sharepoint_connections')->cascadeOnDelete();

            $table->string('graph_item_id', 256);
            $table->string('graph_parent_id', 256)->nullable();
            $table->string('item_type', 8);            // file | folder

            // Exactly one of these is set.
            $table->foreignId('file_id')->nullable()->constrained('files')->cascadeOnDelete();
            $table->foreignId('folder_id')->nullable()->constrained('folders')->cascadeOnDelete();

            /*
             * eTag changes on ANY change (including metadata); cTag changes
             * only when the CONTENT changes. Keeping both is what lets a
             * rename be told apart from a new version — treating every eTag
             * change as new content would create a version per rename.
             */
            $table->string('etag', 191)->nullable();
            $table->string('ctag', 191)->nullable();

            $table->string('web_url', 1024)->nullable();
            $table->string('name')->nullable();
            $table->unsignedBigInteger('size')->nullable();
            $table->string('mime_type', 191)->nullable();

            $table->timestamp('graph_created_at')->nullable();
            $table->timestamp('graph_modified_at')->nullable();
            $table->string('graph_modified_by')->nullable();

            // synced | pending | syncing | conflict | failed
            $table->string('sync_status', 16)->default('synced');
            $table->text('conflict_reason')->nullable();
            $table->text('last_error')->nullable();
            $table->unsignedSmallInteger('failure_count')->default(0);
            $table->timestamp('last_synced_at')->nullable();

            $table->timestamps();

            // One mapping per Graph item per connection — the anti-duplicate
            // guarantee, enforced by the database rather than by convention.
            $table->unique(['connection_id', 'graph_item_id']);
            $table->index('file_id');
            $table->index('folder_id');
            $table->index(['connection_id', 'sync_status']);
        });

        Schema::create('sharepoint_sync_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('connection_id')->constrained('sharepoint_connections')->cascadeOnDelete();
            $table->string('action', 40);
            $table->string('level', 8)->default('info');   // info | warning | error
            $table->string('graph_item_id', 256)->nullable();
            $table->text('detail')->nullable();
            $table->json('meta')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['connection_id', 'created_at']);
            $table->index('level');
        });

        Schema::table('files', function (Blueprint $table) {
            /*
             * Where this file was born. The firm chose "portal wins for
             * portal-originated files", so conflict resolution has to know
             * which side authored it — without this the rule cannot be applied.
             */
            $table->string('origin', 16)->default('portal')->after('version_number');
        });

        Schema::table('folders', function (Blueprint $table) {
            $table->string('origin', 16)->default('portal')->after('folder_type');
        });
    }

    public function down(): void
    {
        Schema::table('folders', fn (Blueprint $t) => $t->dropColumn('origin'));
        Schema::table('files', fn (Blueprint $t) => $t->dropColumn('origin'));
        Schema::dropIfExists('sharepoint_sync_logs');
        Schema::dropIfExists('sharepoint_items');
        Schema::dropIfExists('sharepoint_connections');
    }
};
