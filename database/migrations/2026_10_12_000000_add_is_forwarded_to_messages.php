<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * A forwarded message used to say so in its own text ("Forwarded: …"),
         * which only worked while the text could not be changed on the way.
         * Now that the person forwarding writes the caption, the mark is the
         * message's and not something typed into it.
         */
        Schema::table('messages', function (Blueprint $table) {
            $table->boolean('is_forwarded')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('is_forwarded');
        });
    }
};
