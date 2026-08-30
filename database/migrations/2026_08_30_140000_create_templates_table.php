<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The Templates page's store.
 *
 * One row per template an administrator has changed, keyed by kind and by
 * the template's key inside that kind. The shipped copy is not stored: a
 * system email with no row sends its default, so a fresh install has nothing
 * to seed and "Restore default" is a delete. Other kinds of template (a
 * compose template, say) share the table through `kind`, with `name` for
 * the ones that are created rather than overridden.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('templates', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('kind', 32);
            $table->string('key', 96);
            $table->string('name', 191)->nullable();
            $table->json('fields')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['kind', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('templates');
    }
};
