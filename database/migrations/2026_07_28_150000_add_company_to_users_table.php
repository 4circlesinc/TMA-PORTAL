<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The profile card has always shown a Company row, but nothing on the user
     * ever filled it — it read an empty dash for every account. Companies do
     * exist in the Client hub, and a client account inherits its company from
     * its client record, but staff had nowhere to say who they work for.
     *
     * This is that field: self-owned, edited on the profile page beside the
     * job title it sits next to on the card.
     */
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('company', 160)->nullable()->after('job_title');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('company');
        });
    }
};
