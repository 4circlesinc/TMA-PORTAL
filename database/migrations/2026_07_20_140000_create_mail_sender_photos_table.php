<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Cached profile photos for the people who email you.
     *
     * Misses are cached as deliberately as hits: most senders are outside the
     * organisation and will never have a photo, and without a negative cache
     * every render would ask the provider about all of them again.
     */
    public function up(): void
    {
        Schema::create('mail_sender_photos', function (Blueprint $table) {
            $table->id();
            // sha256 of the lowercased address: the public handle used in photo
            // URLs, so an email address never appears in a page's markup.
            $table->string('hash', 64)->unique();
            $table->string('email');
            $table->foreignId('connected_account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('disk', 32)->nullable();
            $table->string('path')->nullable();
            $table->string('mime', 64)->nullable();
            $table->boolean('has_photo')->default(false);
            $table->timestamp('checked_at')->nullable();
            $table->timestamps();

            $table->index('has_photo');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mail_sender_photos');
    }
};
