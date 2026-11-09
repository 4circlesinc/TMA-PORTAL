<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The notes that go with a decision recorded on the form.
 *
 * A post-approval file staff add records the Unit's decision as it is
 * filled in: the outcome, the day, the letter, and notes on it. The first
 * three were kept on the draft; the notes only travelled with the request
 * that filed it, so a draft saved and reopened came back without them. They
 * are kept here until it is filed, and the decision's history entry carries
 * them from then on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->text('decision_note')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('cip_applications', function (Blueprint $table) {
            $table->dropColumn('decision_note');
        });
    }
};
