<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An approver's feedback note, left when they approve or request changes.
     * Separate from decline_reason (a signer's refusal) so the two read
     * distinctly on the sender's side.
     */
    public function up(): void
    {
        Schema::table('signature_recipients', function (Blueprint $table) {
            $table->text('comment')->nullable()->after('decline_reason');
        });
    }

    public function down(): void
    {
        Schema::table('signature_recipients', function (Blueprint $table) {
            $table->dropColumn('comment');
        });
    }
};
