<?php

use App\Models\FileItem;
use App\Models\Folder;
use App\Support\Files\ReviewStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every client document that already existed enters the review as pending.
 *
 * The observer only fires on create, so without this the feature would only
 * ever apply to files uploaded after the deploy — a client folder with two
 * years of documents in it would show a status against the next one added and
 * nothing against any of the rest, which reads as broken rather than new.
 *
 * Pending review, not approved: nobody has actually reviewed these through
 * this process, and starting them anywhere else would be the migration
 * asserting something untrue about work that was never done.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Every folder that is, or descends from, a client folder — resolved
        // once here rather than walking the tree per file.
        $parents = Folder::query()->pluck('parent_id', 'id')->all();

        $clientRoots = Folder::query()
            ->where('folder_type', Folder::TYPE_CLIENT)
            ->whereNotNull('client_id')
            ->pluck('id')
            ->flip()
            ->all();

        $isClientFolder = [];

        foreach (array_keys($parents) as $id) {
            $chain = [];
            $node = $id;
            $found = false;
            $seen = [];

            while ($node !== null && ! isset($seen[$node])) {
                $seen[$node] = true;

                if (isset($isClientFolder[$node])) {
                    $found = $isClientFolder[$node];
                    break;
                }
                if (isset($clientRoots[$node])) {
                    $found = true;
                    break;
                }

                $chain[] = $node;
                $node = $parents[$node] ?? null;
            }

            foreach ($chain as $walked) {
                $isClientFolder[$walked] = $found;
            }
            $isClientFolder[$id] = $found;
        }

        $ids = array_keys(array_filter($isClientFolder));

        if (! $ids) {
            return;
        }

        // Chunked: a mature library can hold tens of thousands of these, and a
        // single UPDATE ... WHERE IN with that many ids is a query some drivers
        // refuse outright.
        foreach (array_chunk($ids, 500) as $chunk) {
            DB::table((new FileItem)->getTable())
                ->whereIn('folder_id', $chunk)
                ->whereNull('review_status')
                ->update(['review_status' => ReviewStatus::PENDING]);
        }
    }

    public function down(): void
    {
        // Only the pending ones: a document somebody has since reviewed carries
        // a decision, and rolling a schema change back is no reason to discard
        // it. The column is dropped by the migration that added it anyway.
        DB::table((new FileItem)->getTable())
            ->where('review_status', ReviewStatus::PENDING)
            ->whereNull('reviewed_at')
            ->update(['review_status' => null]);
    }
};
