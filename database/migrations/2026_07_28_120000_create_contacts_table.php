<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Address-book entries — the People section's Shared and Personal address
     * books.
     *
     * These are contacts, not accounts: someone you email or share a file with
     * who has no portal login and is not a client record. Both books are the
     * same shape, so they are one table split by `scope`:
     *
     *  - shared   → account-wide, visible to every staff member, owner_id null
     *  - personal → private to owner_id, never readable by anyone else
     */
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            // shared | personal
            $table->string('scope', 16)->default('personal');
            // Null for shared entries; the sole reader/writer for personal ones.
            $table->foreignId('owner_id')->nullable()->constrained('users')->cascadeOnDelete();

            $table->string('first_name');
            $table->string('last_name')->nullable();
            $table->string('email')->nullable();
            $table->string('company')->nullable();
            $table->string('phone', 64)->nullable();
            $table->string('job_title')->nullable();
            $table->text('notes')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            // The two list queries: a book, ordered by name.
            $table->index(['scope', 'owner_id']);
            $table->index('last_name');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};
