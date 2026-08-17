<?php

use App\Support\Cip\Tree;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where a requirement's uploads are filed, inside the person's own folder.
 *
 * A requirement can now name a drawer — "Passport" on the bio-page template
 * puts every bio page in Main Applicant → Passport — so a repository with
 * forty scans in it reads as a filing cabinet rather than a pile. Null means
 * the person's folder itself, which is what every requirement did before this
 * column and stays the default.
 *
 * It is a NAME, never a path. {@see Tree::subfolder} creates
 * the child under the person's folder it is handed, so nothing an
 * administrator types here can file a document outside the person's own
 * repository. And like the label, it only reaches forward: renaming the
 * drawer moves nothing already filed — those files keep the place they were
 * put, the way a reworded label keeps the words a slot was answered under.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->string('folder', 64)->nullable()->after('help');
        });
    }

    public function down(): void
    {
        Schema::table('cip_document_requirements', function (Blueprint $table) {
            $table->dropColumn('folder');
        });
    }
};
