<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Everyone a mailbox has heard from or written to, one row per
        // address per user, kept up to date by the sync. The compose
        // typeahead reads this instead of scanning the newest 200 messages
        // on every keystroke, so it is both complete and quick.
        Schema::create('mail_correspondents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('name')->nullable();
            $table->unsignedInteger('count')->default(0);
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'email']);
            $table->index(['user_id', 'count']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_correspondents');
    }
};
