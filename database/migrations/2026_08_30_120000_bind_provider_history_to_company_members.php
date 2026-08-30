<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Service Provider history used to hang off the contact's user account.
 *
 * Deleting that account cascaded comments and workflow steps away, and
 * nulled cip_events.actor_id so the Activity tab credited the system with
 * a person's upload. Re-inviting the same address minted a new user id,
 * so nothing that survived still looked like theirs.
 *
 * Membership is the row that outlives the login ({@see CompanyMembers::add}
 * revives it by email). These columns bind comments, workflows, documents
 * and the CIP audit to that row, and the user FKs stop deleting the history
 * they used to point at.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_events', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
            $table->string('actor_name', 191)->nullable();
        });

        Schema::table('cip_document_comments', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
            $table->string('author_name', 191)->nullable();
        });

        Schema::table('cip_documents', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
        });

        Schema::table('file_comments', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
            $table->string('author_name', 191)->nullable();
        });

        Schema::table('file_workflows', function (Blueprint $table) {
            $table->foreignId('created_by_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
        });

        Schema::table('file_workflow_steps', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
        });

        Schema::table('file_workflow_events', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
            $table->string('actor_name', 191)->nullable();
        });

        Schema::table('file_activities', function (Blueprint $table) {
            $table->foreignId('company_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
            $table->string('actor_name', 191)->nullable();
        });

        Schema::table('files', function (Blueprint $table) {
            $table->foreignId('uploaded_by_member_id')->nullable()
                ->constrained('company_members')->nullOnDelete();
        });

        $this->retargetUserFk('cip_document_comments', 'author_id', nullable: true);
        $this->retargetUserFk('file_comments', 'author_id', nullable: true);
        $this->retargetUserFk('file_workflow_steps', 'user_id', nullable: true);
        $this->retargetUserFk('file_workflows', 'created_by', nullable: true);
        $this->retargetUserFk('company_members', 'user_id', nullable: true);
        $this->retargetUserFk('files', 'uploaded_by', nullable: true);

        $this->backfill();
    }

    public function down(): void
    {
        Schema::table('cip_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
            $table->dropColumn('actor_name');
        });
        Schema::table('cip_document_comments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
            $table->dropColumn('author_name');
        });
        Schema::table('cip_documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
        });
        Schema::table('file_comments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
            $table->dropColumn('author_name');
        });
        Schema::table('file_workflows', function (Blueprint $table) {
            $table->dropConstrainedForeignId('created_by_member_id');
        });
        Schema::table('file_workflow_steps', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
        });
        Schema::table('file_workflow_events', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
            $table->dropColumn('actor_name');
        });
        Schema::table('file_activities', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_member_id');
            $table->dropColumn('actor_name');
        });
        Schema::table('files', function (Blueprint $table) {
            $table->dropConstrainedForeignId('uploaded_by_member_id');
        });
    }

    /**
     * History must not cascade away with the login. nullOnDelete keeps the
     * row; company_member_id / actor_name is what still names the person.
     */
    private function retargetUserFk(string $table, string $column, bool $nullable): void
    {
        Schema::table($table, function (Blueprint $blueprint) use ($column) {
            $blueprint->dropForeign([$column]);
        });

        Schema::table($table, function (Blueprint $blueprint) use ($column, $nullable) {
            if ($nullable) {
                $blueprint->unsignedBigInteger($column)->nullable()->change();
            }
            $blueprint->foreign($column)->references('id')->on('users')->nullOnDelete();
        });
    }

    private function backfill(): void
    {
        // Names first: once a login is purged there is nothing left to copy.
        DB::update('UPDATE cip_events SET actor_name = (SELECT name FROM users WHERE users.id = cip_events.actor_id) WHERE actor_id IS NOT NULL AND actor_name IS NULL');
        DB::update('UPDATE cip_document_comments SET author_name = (SELECT name FROM users WHERE users.id = cip_document_comments.author_id) WHERE author_id IS NOT NULL AND author_name IS NULL');
        DB::update('UPDATE file_comments SET author_name = (SELECT name FROM users WHERE users.id = file_comments.author_id) WHERE author_id IS NOT NULL AND author_name IS NULL');
        DB::update('UPDATE file_workflow_events SET actor_name = (SELECT name FROM users WHERE users.id = file_workflow_events.actor_id) WHERE actor_id IS NOT NULL AND actor_name IS NULL');
        DB::update('UPDATE file_activities SET actor_name = (SELECT name FROM users WHERE users.id = file_activities.user_id) WHERE user_id IS NOT NULL AND actor_name IS NULL');

        $this->backfillMember(
            'cip_events',
            'actor_id',
            'company_member_id',
            'SELECT provider_id FROM cip_applications WHERE cip_applications.id = cip_events.application_id',
        );
        $this->backfillMember(
            'cip_document_comments',
            'author_id',
            'company_member_id',
            'SELECT a.provider_id FROM cip_documents d JOIN cip_applications a ON a.id = d.application_id WHERE d.id = cip_document_comments.document_id',
        );
        $this->backfillMember(
            'cip_documents',
            'uploaded_by',
            'company_member_id',
            'SELECT provider_id FROM cip_applications WHERE cip_applications.id = cip_documents.application_id',
        );
        $this->backfillMember('file_comments', 'author_id', 'company_member_id');
        $this->backfillMember('file_workflow_steps', 'user_id', 'company_member_id');
        $this->backfillMember('file_workflow_events', 'actor_id', 'company_member_id');
        $this->backfillMember('file_activities', 'user_id', 'company_member_id');
        $this->backfillMember('file_workflows', 'created_by', 'created_by_member_id');
        $this->backfillMember('files', 'uploaded_by', 'uploaded_by_member_id');
    }

    /**
     * Point existing rows at the membership that currently holds this login,
     * scoped to the application's provider firm when that is knowable.
     */
    private function backfillMember(string $table, string $userColumn, string $memberColumn, ?string $providerSubquery = null): void
    {
        $providerJoin = $providerSubquery
            ? 'AND company_members.company_id = (SELECT company_id FROM cip_providers WHERE cip_providers.id = ('.$providerSubquery.'))'
            : '';

        DB::update(
            "UPDATE {$table} SET {$memberColumn} = (
                SELECT company_members.id FROM company_members
                WHERE company_members.user_id = {$table}.{$userColumn}
                {$providerJoin}
                ORDER BY company_members.id DESC LIMIT 1
            ) WHERE {$userColumn} IS NOT NULL AND {$memberColumn} IS NULL"
        );
    }
};
