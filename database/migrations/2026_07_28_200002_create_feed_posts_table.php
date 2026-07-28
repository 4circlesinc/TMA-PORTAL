<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A post in a channel — and, in the same table, the draft it started as
     * and the scheduled publication it may be waiting on.
     *
     * Drafts and scheduled posts are *states*, not separate tables. A draft
     * that gets a time becomes `scheduled`; the queue worker flips it to
     * `published`. Keeping one row means editing a scheduled post is an
     * ordinary update, the post keeps its uuid from first keystroke to
     * publication, and attachments never have to be re-parented.
     *
     * `body` is the sanitised rich-text HTML the reader sees; `body_text` is
     * the same content flattened, and exists solely so search can match on it
     * without stripping tags per row.
     *
     * Counter columns are denormalised for the same reason as the channel's:
     * the stream renders reaction and comment counts on every card, and
     * counting them per card per request is what makes an infinite feed slow.
     */
    public function up(): void
    {
        Schema::create('feed_posts', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('channel_id')->constrained('feed_channels')->cascadeOnDelete();
            $table->foreignId('author_id')->constrained('users')->cascadeOnDelete();

            // discussion | question | praise | poll | announcement
            $table->string('post_type', 24)->default('discussion');

            // Optional. Announcements almost always have one; a quick
            // discussion post usually does not.
            $table->string('title')->nullable();
            // Sanitised rich text. See App\Support\Feed\FeedContent for the
            // allow-list — nothing reaches this column unsanitised.
            $table->longText('body')->nullable();
            // Flattened copy of `body`, for search only.
            $table->longText('body_text')->nullable();

            // draft | scheduled | published | archived
            $table->string('status', 16)->default('draft');

            $table->boolean('is_pinned')->default(false);
            $table->timestamp('pinned_at')->nullable();
            $table->foreignId('pinned_by')->nullable()->constrained('users')->nullOnDelete();

            /*
             * Announcement behaviour. An announcement is a post_type, but each
             * of its powers is opt-in: it can be highlighted without demanding
             * acknowledgement, and it can expire without being pinned.
             */
            $table->boolean('requires_acknowledgement')->default(false);
            // After this moment the post stops being highlighted and drops out
            // of the pinned band. It is never deleted — the record stands.
            $table->timestamp('expires_at')->nullable();

            /*
             * Scheduling. `scheduled_for` is stored UTC like every other
             * timestamp; `timezone` records the zone the author actually chose
             * so the UI can show back "9:00 AM Atlantic/Bermuda" rather than
             * the shifted local rendering of a UTC instant.
             */
            $table->timestamp('scheduled_for')->nullable();
            $table->string('timezone', 64)->nullable();
            $table->timestamp('published_at')->nullable();
            // Set only on a real content edit, so the "Edited" chip does not
            // appear when a post was merely pinned or its counters moved.
            $table->timestamp('edited_at')->nullable();

            $table->boolean('comments_locked')->default(false);

            /*
             * Email fan-out. `email_audience` is the author's choice at publish
             * time — none | everyone | members | mentioned | groups — and
             * `email_groups` names the groups when it is `groups`.
             * `email_sent_at` makes the send idempotent: a re-published or
             * retried post never mails the channel twice.
             */
            $table->string('email_audience', 16)->default('none');
            $table->jsonb('email_groups')->nullable();
            $table->timestamp('email_sent_at')->nullable();
            // Whether publishing raises portal notifications at all.
            $table->boolean('notify_portal')->default(true);

            $table->unsignedInteger('views_count')->default(0);
            $table->unsignedInteger('comments_count')->default(0);
            $table->unsignedInteger('reactions_count')->default(0);
            $table->unsignedInteger('shares_count')->default(0);

            $table->jsonb('metadata')->nullable();

            $table->timestamps();
            $table->softDeletes();

            // The stream: one channel, published, newest first, pinned on top.
            $table->index(['channel_id', 'status', 'published_at']);
            $table->index(['channel_id', 'is_pinned', 'published_at']);
            // "My drafts" and "my scheduled posts" — both are author-scoped.
            $table->index(['author_id', 'status']);
            // What the publish worker claims each minute.
            $table->index(['status', 'scheduled_for']);
            $table->index('deleted_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_posts');
    }
};
