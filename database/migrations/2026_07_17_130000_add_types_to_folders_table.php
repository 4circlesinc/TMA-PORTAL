<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Give folders a kind and the links the Client hub needs. Regular user
     * folders keep `folder_type = 'user'` and behave exactly as before; the
     * new kinds carry the relationships that drive access:
     *
     *  - root         : the "Client Files" / "Staff Files" containers
     *  - organization : shared internal folders (audience decides who)
     *  - client       : one per client, linked by client_id (never by name)
     *  - staff        : one per staff member, linked by subject_user_id
     */
    public function up(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->string('folder_type', 16)->default('user')->after('name');
            $table->foreignId('client_id')->nullable()->after('folder_type')
                ->constrained('clients')->nullOnDelete();
            $table->foreignId('subject_user_id')->nullable()->after('client_id')
                ->constrained('users')->nullOnDelete();
            // Organization folders: who they reach without a per-user share.
            // null = nobody automatic (selected staff only, via shares);
            // 'all_staff' = every Administrator/Employee.
            $table->string('audience', 16)->nullable()->after('subject_user_id');
            $table->string('audience_role', 16)->nullable()->after('audience');
            $table->boolean('org_wide')->default(false)->after('audience_role');
            $table->boolean('is_archived')->default(false)->after('org_wide');

            $table->index('folder_type');
            $table->index('client_id');
            $table->index('subject_user_id');
        });
    }

    public function down(): void
    {
        Schema::table('folders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('client_id');
            $table->dropConstrainedForeignId('subject_user_id');
            $table->dropColumn(['folder_type', 'audience', 'audience_role', 'org_wide', 'is_archived']);
        });
    }
};
