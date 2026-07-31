<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One invitation record for every kind of "come and join the portal".
 *
 * This replaces `client_invites`, which only knew how to invite a client and
 * stored its token in plain text. Three things travel together on every row and
 * so belong in one table rather than three:
 *
 *  - who is being asked (email, name) and by whom (invited_by),
 *  - what they are being offered (type, role, client_id, company_id, access),
 *  - where the invitation has got to (status and its timestamps).
 *
 * The token is never stored. `token_hash` holds a SHA-256 of the value that
 * goes in the emailed link, so a database leak cannot be replayed into portal
 * accounts. Lookup is by hash, which is why the digest is unsalted — see
 * App\Models\Invitation::hash().
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invitations', function (Blueprint $table) {
            $table->id();
            // The id used in URLs and the management UI. Never the token.
            $table->uuid('uuid')->unique();

            // client | staff | company_member
            $table->string('type', 24);

            // SHA-256 of the emailed token. Unique so a resend that mints a new
            // token can never collide with a live one.
            $table->string('token_hash', 64)->unique();

            $table->string('email');
            $table->string('name')->nullable();

            // What the invitation is attached to. A client invite carries a
            // client_id; a company member invite carries a company_id; a staff
            // invite carries neither.
            $table->foreignId('client_id')->nullable()->constrained('clients')->cascadeOnDelete();
            $table->foreignId('company_id')->nullable()->constrained('companies')->cascadeOnDelete();

            // The account_type the accepted user will hold (Client/Employee/Administrator).
            $table->string('role', 32)->default('Client');
            // Type-specific extras: company role, permission level, department…
            $table->jsonb('access')->nullable();

            // pending | sent | delivered | opened | accepted | expired | cancelled | failed
            $table->string('status', 16)->default('pending');

            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();
            // The account that ended up accepting — new or pre-existing.
            $table->foreignId('accepted_user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('expires_at')->nullable();
            $table->timestamp('last_sent_at')->nullable();
            $table->timestamp('opened_at')->nullable();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();

            // How many times it has been emailed, for the management screen.
            $table->unsignedSmallInteger('send_count')->default(0);
            // Why the last send failed, shown to staff so they can act on it.
            $table->text('last_error')->nullable();

            $table->timestamps();

            // The management screen filters by status, newest first.
            $table->index(['status', 'created_at']);
            // "Is there already a live invite for this address?"
            $table->index(['email', 'status']);
            $table->index('client_id');
            $table->index('company_id');
            $table->index('type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invitations');
    }
};
