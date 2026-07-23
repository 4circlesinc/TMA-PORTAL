<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The portal-wide audit trail. Every meaningful action a user or the system
     * takes lands here as one immutable row, feeding the Overview → Activity log,
     * the right-sidebar Activities section, and the Activities header popup.
     *
     * `actor_id` is null when the system itself performed the action (a sync, a
     * scheduled job). `subject` is the polymorphic record the action was about
     * (a file, a client, a calendar event). `old_values`/`new_values` hold a
     * redacted before/after diff — never secrets, tokens, or file contents.
     */
    public function up(): void
    {
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();
            // Public identifier the UI addresses rows by; storage ids stay hidden.
            $table->ulid('uid')->unique();
            // Null actor = system-generated activity.
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('activity_type', 64);   // e.g. 'client.created', 'file.deleted'
            $table->string('module', 32);          // clients | files | calendar | email | messages | signatures | account | security | system
            $table->string('action', 32);          // created | updated | deleted | restored | shared | signed | ...
            $table->string('description', 500);    // human-readable sentence rendered in the log
            $table->nullableMorphs('subject');     // subject_type + subject_id (+ index): the affected record
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            $table->jsonb('old_values')->nullable();
            $table->jsonb('new_values')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();
            $table->string('status', 16)->default('success'); // success | failure | pending
            $table->jsonb('metadata')->nullable();
            $table->timestamps();

            $table->index('actor_id');
            $table->index('activity_type');
            $table->index('module');
            $table->index('client_id');
            $table->index('status');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
