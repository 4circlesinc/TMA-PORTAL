<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->foreignId('decision_letter_file_id')
                ->nullable()
                ->after('decision')
                ->constrained('files')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropConstrainedForeignId('decision_letter_file_id');
        });
    }
};
