<?php

use App\Support\Cip\ProviderMerge;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /**
     * One row per firm. Applications filed under a duplicate code join the
     * firm that remains; their numbers stay as they were minted.
     */
    public function up(): void
    {
        ProviderMerge::run();
    }

    public function down(): void
    {
        // The duplicate rows were the same firm. Putting them back would
        // split applications that now belong together.
    }
};
