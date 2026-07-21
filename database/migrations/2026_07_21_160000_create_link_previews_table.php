<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Cached Open Graph metadata for URLs shared in messages.
     *
     * Keyed by a hash of the URL rather than the URL itself so the unique index
     * works regardless of length. Cached because the composer asks for a
     * preview *while the user is typing* — refetching a link every keystroke,
     * or every time a message is rendered, would hammer other people's sites.
     *
     * Failures are cached too, as `status = 'failed'`: a URL with no metadata
     * should stop being asked about, not be retried on every render.
     */
    public function up(): void
    {
        Schema::create('link_previews', function (Blueprint $table) {
            $table->id();
            $table->string('url_hash', 64)->unique();
            $table->text('url');

            $table->string('status', 16)->default('ok');   // ok | failed
            $table->string('site_name')->nullable();
            $table->text('title')->nullable();
            $table->text('description')->nullable();
            $table->text('image_url')->nullable();
            $table->string('domain', 191)->nullable();
            $table->text('favicon_url')->nullable();

            // Lets a stale or previously failed entry be refetched later
            // without keeping the row forever.
            $table->timestamp('fetched_at')->nullable();
            $table->timestamps();

            $table->index('fetched_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('link_previews');
    }
};
