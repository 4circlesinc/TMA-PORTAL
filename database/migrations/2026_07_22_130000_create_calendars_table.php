<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A calendar: the container events belong to, and the unit sharing and
     * permissions are granted on.
     *
     * One row covers every kind the sidebar groups by — a user's personal
     * calendar, a team or department calendar, a client calendar, and (from
     * the sync phases) a mirrored Google/Microsoft calendar or an imported
     * ICS file. `calendar_type` is what the calendar *is*; `source` is where
     * its events come from. Keeping those separate means a Marketing Team
     * calendar can later be backed by Google without changing its type.
     *
     * Who may see it is never decided here alone: `visibility` is only the
     * broad default, and calendar_members carries the explicit grants.
     */
    public function up(): void
    {
        Schema::create('calendars', function (Blueprint $table) {
            $table->id();
            // Public identifier. The UI addresses calendars by uuid; storage
            // ids are never exposed, matching folders and clients.
            $table->uuid('uuid')->unique();

            $table->string('name');
            $table->text('description')->nullable();
            // A design-system colour name ('blue', 'purple'), not a hex value,
            // so the sidebar, grid, and agenda all resolve the same token.
            $table->string('colour', 24)->default('blue');

            // personal | shared | group | department | project | client | organization
            $table->string('calendar_type', 24)->default('personal');

            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            // Set only for client calendars, so a client's meetings and
            // deadlines can be pulled onto their profile.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();

            $table->string('timezone', 64)->default('UTC');

            // The broad default when no explicit member grant applies:
            //   private   — owner and explicit members only
            //   shared    — members only, but discoverable by name
            //   all_staff — every Administrator/Employee may find and add it
            // Clients never fall into all_staff; that is enforced in the
            // access layer, not here.
            $table->string('visibility', 16)->default('private');

            // Permission level a member gets when added without an explicit
            // one. See App\Support\Calendar\CalendarAccess for the ladder.
            $table->string('default_role', 16)->default('details');

            // Where the events come from: local | google | microsoft |
            // ics_import | ics_subscription. Everything but 'local' is filled
            // in by the sync phases; the columns exist now so a calendar never
            // has to be migrated between tables to gain a source.
            $table->string('source', 24)->default('local');
            $table->foreignId('connected_account_id')->nullable()
                ->constrained('connected_accounts')->nullOnDelete();
            // The provider's own id for this calendar. Paired with the account
            // it belongs to, this is what keeps sync from duplicating.
            $table->string('external_id', 512)->nullable();
            $table->text('subscription_url')->nullable();

            // A personal calendar is provisioned automatically and cannot be
            // deleted — only its events can. Guards the sidebar's Delete.
            $table->boolean('is_system')->default(false);
            $table->boolean('is_archived')->default(false);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index('owner_id');
            $table->index('calendar_type');
            $table->index('client_id');
            $table->index('deleted_at');
            // Sync lookups always arrive as "this account's calendar X".
            $table->index(['connected_account_id', 'source']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('calendars');
    }
};
