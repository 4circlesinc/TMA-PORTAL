<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * What someone is currently working on, shown in the Updates tab.
     *
     * One row per person, not a history: this answers "what is Ana doing right
     * now", and a status nobody is showing is simply deleted. Keeping a log
     * would turn a convenience into a record of everyone's day, which is a
     * different thing to hold about staff and not what this is for.
     *
     * Distinct from presence (user_presence), which is derived from a
     * heartbeat and says only whether someone's tab is open. This is what they
     * chose to tell colleagues.
     */
    public function up(): void
    {
        Schema::create('user_work_statuses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            // Optional decoration, stored separately from the text so a status
            // can be rendered as "🏝 On leave" without parsing the string.
            $table->string('emoji', 16)->nullable();
            $table->string('text', 140);

            // Null means "until I clear it". A set expiry is enforced at read
            // time rather than by a cleanup job, so a status is never shown
            // past its time even if nothing has swept the table.
            $table->timestamp('expires_at')->nullable();

            $table->timestamps();

            // The Updates list reads newest-first across everyone.
            $table->index('updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_work_statuses');
    }
};
