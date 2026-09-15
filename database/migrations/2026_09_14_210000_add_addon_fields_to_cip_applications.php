<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add-On applications hang off a granted parent file, and the COR number
     * is how an agent names that parent. Relationship grows because Add-On
     * asks Son / Daughter / Other Qualified Dependent rather than the two
     * values the original family form used.
     */
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('parent_application_id')
                ->nullable()
                ->after('provider_id')
                ->constrained('cip_applications')
                ->nullOnDelete();
            $table->string('addon_type', 32)->nullable()->after('phase');
            $table->string('cor_number', 64)->nullable()->after('cip_number');

            $table->index('cor_number');
            $table->index('parent_application_id');
        });

        Schema::table('cip_people', function (Blueprint $table) {
            $table->string('nationality', 191)->nullable()->after('country_of_residence');
            $table->string('relationship', 48)->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->dropColumn('nationality');
            $table->string('relationship', 24)->nullable()->change();
        });

        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_application_id');
            $table->dropColumn(['addon_type', 'cor_number']);
        });
    }
};
