<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Companies in the Client hub. A company can have many contact persons
     * (`clients.company_id`). The denormalised `clients.company` string stays
     * in sync for search/listing.
     */
    public function up(): void
    {
        Schema::create('companies', function (Blueprint $table) {
            $table->id();
            $table->string('uid', 96)->unique();
            $table->string('name');
            $table->string('website')->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('name');
            $table->index('deleted_at');
        });

        Schema::table('clients', function (Blueprint $table) {
            $table->foreignId('company_id')->nullable()->after('folder_id')->constrained('companies')->nullOnDelete();
            $table->index('company_id');
        });
    }

    public function down(): void
    {
        Schema::table('clients', function (Blueprint $table) {
            $table->dropConstrainedForeignId('company_id');
        });
        Schema::dropIfExists('companies');
    }
};
