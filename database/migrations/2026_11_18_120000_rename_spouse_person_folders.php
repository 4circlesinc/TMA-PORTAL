<?php

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Support\Cip\Tree;
use Illuminate\Database\Migrations\Migration;

/**
 * A spouse's folder is "Spouse", not "Dependent 2".
 *
 * {@see Tree::folderName()} used to number a spouse among the dependants, so
 * the spouse's papers sat in a "Dependent N" folder in the package and again
 * under Post-Approval Documents. It names them "Spouse" now. New trees get
 * that by construction; this renames the folders already standing, in place.
 * The ids stay, so every paper, comment and SharePoint link inside stays
 * where it is, and the rename reaches SharePoint the way any other does.
 *
 * Only files with a spouse are touched, and only person folders are renamed:
 * nothing is merged, moved or pruned here.
 */
return new class extends Migration
{
    public function up(): void
    {
        $ids = CipPerson::query()
            ->where('role', CipPerson::ROLE_DEPENDENT)
            ->where('relationship', CipPerson::RELATIONSHIP_SPOUSE)
            ->where(fn ($query) => $query
                ->whereNotNull('folder_id')
                ->orWhereNotNull('post_approval_folder_id'))
            ->distinct()
            ->pluck('application_id');

        CipApplication::query()
            ->whereIn('id', $ids)
            ->with('people')
            ->chunkById(100, function ($applications) {
                foreach ($applications as $application) {
                    Tree::renamePersonFolders($application);
                }
            });
    }

    public function down(): void
    {
        // Which number each spouse's folder had is not recorded, and the next
        // provision would rename it back to "Spouse" anyway.
    }
};
