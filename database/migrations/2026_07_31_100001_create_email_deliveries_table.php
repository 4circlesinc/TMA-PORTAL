<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What actually happened to every transactional email the portal sent.
 *
 * Queueing a mailable told us nothing: an invitation could sit in `jobs` for a
 * week, or fail on the transport, and the invite screen would still say "sent".
 * A row is written when mail is handed to the queue and then updated by the
 * mail events (see App\Providers\MailTrackingServiceProvider), so "sent" means
 * the transport accepted it — not that we asked it to.
 *
 * `related_type`/`related_id` is a plain morph to whatever the mail was about
 * (an Invitation, a Client, a User), so the invitation screen can show its own
 * delivery history without a second lookup table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_deliveries', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->string('recipient');
            $table->string('subject')->nullable();
            // The Postcards helper that built it, e.g. 'clientInvite'.
            $table->string('template', 64)->nullable();
            $table->string('mailable')->nullable();

            $table->nullableMorphs('related');

            // queued | sent | delivered | opened | clicked | failed | bounced | cancelled
            $table->string('status', 16)->default('queued');

            // The transport's id, so a bounce webhook can find this row later.
            $table->string('message_id')->nullable()->index();
            $table->text('error')->nullable();

            $table->unsignedSmallInteger('retry_count')->default(0);
            $table->timestamp('last_retry_at')->nullable();

            $table->timestamp('queued_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('opened_at')->nullable();
            $table->timestamp('clicked_at')->nullable();
            $table->timestamp('failed_at')->nullable();

            $table->timestamps();

            $table->index(['status', 'created_at']);
            $table->index('recipient');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_deliveries');
    }
};
