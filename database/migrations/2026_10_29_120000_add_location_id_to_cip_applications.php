<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Which office of the service provider may see this application.
     *
     * Null is the firm book: the main office and a service provider admin.
     * A branch id limits the file to the people who sit on that branch.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('location_id')
                ->nullable()
                ->after('provider_id')
                ->constrained('company_locations')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('location_id');
        });
    }
};
