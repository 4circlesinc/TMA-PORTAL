<?php

use App\Support\Cip\ProviderMerge;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /**
     * The first pass missed a date suffix and a numbered copy whose code
     * had already been retired, and the folder import then minted another.
     */
    public function up(): void
    {
        ProviderMerge::run();
    }

    public function down(): void
    {
        //
    }
};
