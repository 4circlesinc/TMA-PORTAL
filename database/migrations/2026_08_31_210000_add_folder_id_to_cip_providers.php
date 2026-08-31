<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_providers', function (Blueprint $table) {
            // The provider's own folder in the Citizenship Applications
            // library — where every application filed under the firm keeps
            // its documents. Nullable: the PRI bucket and hand-made
            // providers may not have one.
            $table->foreignId('folder_id')->nullable()->after('company_id')
                ->constrained('folders')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_providers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('folder_id');
        });
    }
};
