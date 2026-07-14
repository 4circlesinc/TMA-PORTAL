<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // pending | approved | suspended — account type is assigned by an
            // administrator at approval time.
            $table->string('status', 20)->default('pending')->index()->after('password');
            $table->timestamp('approved_at')->nullable()->after('status');
            $table->foreignId('approved_by')->nullable()->after('approved_at')->constrained('users')->nullOnDelete();
            $table->string('account_type', 40)->nullable()->after('approved_by');
            $table->string('phone', 30)->nullable()->after('account_type');
            $table->timestamp('phone_verified_at')->nullable()->after('phone');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('approved_by');
            $table->dropColumn(['status', 'approved_at', 'account_type', 'phone', 'phone_verified_at']);
        });
    }
};
