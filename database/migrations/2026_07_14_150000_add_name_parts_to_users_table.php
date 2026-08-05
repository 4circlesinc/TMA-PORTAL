<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('first_name')->nullable()->after('name');
            $table->string('middle_name')->nullable()->after('first_name');
            $table->string('last_name')->nullable()->after('middle_name');
        });

        // Split existing display names: first word, last word, rest in between.
        //
        // Deliberately the query builder, not the User model. A migration runs
        // against the schema as it stood at this point in history, while the
        // model describes today's - once User gained SoftDeletes, an Eloquent
        // query here started asking for a `deleted_at` column that no migration
        // has added yet, and every fresh install died on it.
        DB::table('users')->whereNull('first_name')->orderBy('id')->each(function ($user) {
            $parts = preg_split('/\s+/', trim((string) $user->name), -1, PREG_SPLIT_NO_EMPTY) ?: [];

            DB::table('users')->where('id', $user->id)->update([
                'first_name' => array_shift($parts) ?: $user->name,
                'last_name' => count($parts) ? array_pop($parts) : null,
                'middle_name' => count($parts) ? implode(' ', $parts) : null,
            ]);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['first_name', 'middle_name', 'last_name']);
        });
    }
};
