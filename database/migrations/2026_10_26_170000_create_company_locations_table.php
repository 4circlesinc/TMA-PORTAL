<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * A service provider's main office and its branches. People with portal
     * access sit on one location, not loose on the firm.
     */
    public function up(): void
    {
        Schema::create('company_locations', function (Blueprint $table) {
            $table->id();
            $table->string('uid', 96)->unique();
            $table->foreignId('company_id')->constrained('companies')->cascadeOnDelete();
            $table->string('name');
            $table->string('kind', 32);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['company_id', 'kind']);
        });

        Schema::table('company_members', function (Blueprint $table) {
            $table->foreignId('location_id')->nullable()->after('company_id')
                ->constrained('company_locations')->nullOnDelete();
        });

        $now = now();

        DB::table('companies')->select('id', 'name')->orderBy('id')->each(function (object $company) use ($now) {
            $locationId = DB::table('company_locations')->insertGetId([
                'uid' => Str::lower((string) Str::ulid()),
                'company_id' => $company->id,
                'name' => trim((string) $company->name).' Main Office',
                'kind' => 'main_office',
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('company_members')
                ->where('company_id', $company->id)
                ->whereNull('location_id')
                ->update(['location_id' => $locationId]);
        });
    }

    public function down(): void
    {
        Schema::table('company_members', function (Blueprint $table) {
            $table->dropConstrainedForeignId('location_id');
        });

        Schema::dropIfExists('company_locations');
    }
};
