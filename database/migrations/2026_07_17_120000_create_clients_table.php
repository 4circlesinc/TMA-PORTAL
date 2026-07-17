<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The firm's client directory (the "Client hub"). Each row is one contact.
     *
     * The contact model is deep and irregular - many phones, emails, addresses,
     * social links, important dates - so the full record lives in `data` (JSON)
     * and matches the shape the clients UI already builds. The top-level columns
     * are denormalised copies kept only for listing, sorting, and search; the
     * client never reads them, it reads `data`.
     */
    public function up(): void
    {
        Schema::create('clients', function (Blueprint $table) {
            $table->id();
            // Public identifier. The UI generates a slug ('bruce-wayne') and
            // addresses every record by it; storage ids are never exposed.
            $table->string('uid', 96)->unique();
            $table->string('name');
            $table->string('company')->nullable();
            $table->string('email')->nullable();
            $table->string('phone', 64)->nullable();
            // Avatar fallback for the list: a letter + colour name, as the UI
            // expects when there's no uploaded photo.
            $table->string('initial', 4)->nullable();
            $table->string('initial_color', 24)->nullable();
            $table->jsonb('data');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('name');
            $table->index('company');
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clients');
    }
};
