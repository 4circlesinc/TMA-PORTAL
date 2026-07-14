<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connected_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 30);
            $table->string('provider_id');
            $table->string('email')->nullable();
            $table->string('name')->nullable();
            $table->timestamps();

            $table->unique(['provider', 'provider_id']);
            $table->unique(['user_id', 'provider']);
        });

        // Social signups get a random password until the user chooses one;
        // the flag guards against disconnecting their only sign-in method.
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('password_auto')->default(false)->after('password');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('connected_accounts');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('password_auto');
        });
    }
};
