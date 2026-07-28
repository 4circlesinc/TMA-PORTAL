<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A Feed channel: the container posts live in, and the unit membership
     * and permissions are granted on.
     *
     * `channel_type` is what the channel *is* (a department, a project, a
     * client space); `visibility` is who may find it. The two are deliberately
     * separate for the same reason calendars keep type and source apart — a
     * Marketing channel can go from org-wide to private without changing what
     * it is, and a client channel is still a client channel when locked down.
     *
     * Who may *do* things is never decided here alone: `visibility` is the
     * broad default and feed_channel_members carries the explicit grants. The
     * *_policy columns say how far down the member ladder each action reaches,
     * so "only moderators may post" is one column rather than a per-member flag.
     *
     * Counter columns (posts_count, members_count, last_activity_at) are
     * denormalised on purpose: the sidebar lists every visible channel with its
     * activity on first paint, and counting posts per channel per request made
     * that list the slowest thing on the page.
     */
    public function up(): void
    {
        Schema::create('feed_channels', function (Blueprint $table) {
            $table->id();
            // Public identifier. The UI addresses channels by uuid; storage ids
            // are never exposed, matching folders, clients and calendars.
            $table->uuid('uuid')->unique();

            $table->string('name');
            // Used in URLs and #channel autocomplete. Unique across the portal
            // so a link to a channel is unambiguous.
            $table->string('slug', 160)->unique();
            $table->text('description')->nullable();

            // company | department | team | project | client | private | public
            $table->string('channel_type', 24)->default('team');

            // The broad default when no explicit member grant applies:
            //   org      — every staff account may find and join it
            //   private  — members only; invisible to everyone else
            //   client   — members only, and the client's own people belong
            // Clients never fall into `org`; that is enforced in FeedAccess.
            $table->string('visibility', 16)->default('org');

            // A design-system colour name ('blue', 'green'), never a hex value,
            // so the sidebar dot, the channel header and the post badge all
            // resolve the same token.
            $table->string('colour', 24)->default('blue');
            // A Phosphor icon basename, e.g. 'Megaphone'.
            $table->string('icon', 64)->default('Hash');

            // Profile picture and cover image. Stored the File Library way —
            // the disk is saved per row rather than assumed, so images written
            // before a disk switch keep resolving.
            $table->string('avatar_disk', 32)->nullable();
            $table->string('avatar_path')->nullable();
            $table->string('cover_disk', 32)->nullable();
            $table->string('cover_path')->nullable();

            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            // Set only for client channels, so a client space can be pulled
            // onto the client's profile.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();
            // Set for department/team channels backed by an existing group, so
            // membership can follow the group rather than being curated twice.
            $table->foreignId('group_id')->nullable()->constrained('groups')->nullOnDelete();

            // Free-form labels for filtering. A list of strings.
            $table->jsonb('tags')->nullable();

            /*
             * How far down the member ladder each action reaches. The value is
             * the *lowest* role that may do it: 'member' | 'moderator' |
             * 'admin'. See App\Support\Feed\FeedAccess for the ladder itself.
             */
            $table->string('post_policy', 16)->default('member');
            $table->string('comment_policy', 16)->default('member');
            // Who may join without being invited: 'anyone' (within visibility)
            // or 'invite' (an admin has to add them).
            $table->string('join_policy', 16)->default('anyone');

            // A company-wide channel is provisioned automatically and cannot be
            // deleted — only archived. Guards the settings screen's Delete.
            $table->boolean('is_system')->default(false);
            // Everyone is a member of a default channel on account creation.
            $table->boolean('is_default')->default(false);
            $table->boolean('is_archived')->default(false);
            $table->timestamp('archived_at')->nullable();
            $table->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();

            // Denormalised for the sidebar; see the class comment.
            $table->unsignedInteger('posts_count')->default(0);
            $table->unsignedInteger('members_count')->default(0);
            $table->timestamp('last_activity_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('owner_id');
            $table->index('channel_type');
            $table->index('client_id');
            $table->index('group_id');
            $table->index('deleted_at');
            // The sidebar's "channels I can see, most active first".
            $table->index(['visibility', 'is_archived']);
            $table->index('last_activity_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feed_channels');
    }
};
