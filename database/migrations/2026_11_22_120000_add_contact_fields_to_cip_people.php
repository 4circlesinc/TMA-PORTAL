<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The main applicant's net worth, email, and whether they want application email.
     *
     * Net worth is whole US dollars, encrypted by the model's cast, so it is
     * text here. Notifications default on: the applicant opts out, not in.
     */
    public function up(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->text('net_worth')->nullable();
            $table->string('email', 191)->nullable();
            $table->boolean('email_notifications')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('cip_people', function (Blueprint $table) {
            $table->dropColumn(['net_worth', 'email', 'email_notifications']);
        });
    }
};
