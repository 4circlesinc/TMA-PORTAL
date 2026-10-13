<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            // The one member whose mailbox this firm's email notifications
            // go to. Null is everyone on its Access list, which is how every
            // firm stood before this. No constraint on purpose: the reader
            // checks the member is still at this firm, so a row that has
            // gone means everyone again, never nobody, and companies and
            // their members do not end up holding each other.
            $table->unsignedBigInteger('notification_member_id')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $table) {
            $table->dropColumn('notification_member_id');
        });
    }
};
