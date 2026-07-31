<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The people at a company who may reach its records, and what each may do.
 *
 * A company account is not one login — it is a finance person who needs the
 * invoices, a signatory who needs the contracts, an event contact who needs the
 * bookings, and usually a primary contact who needs most of it. Before this
 * there was no way to express any of that: a person was either a `clients` row
 * with a login or nothing at all, and access was per-person file shares.
 *
 * A member may exist before they have an account. `user_id` is null until they
 * accept an invitation; `client_id` points at the contact record staff created
 * for them. That is what lets a company be set up in full and invited later.
 *
 * The `can_*` flags are the effective permission. A role sets sensible defaults
 * (see App\Support\Companies\CompanyRoles) but the flags are what is checked, so
 * one person can always be given something their role would not normally carry.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('company_members', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();

            $table->foreignId('company_id')->constrained()->cascadeOnDelete();
            // Null until they accept an invitation and have a login.
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            // The client-hub contact record for this person, if there is one.
            $table->foreignId('client_id')->nullable()->constrained('clients')->nullOnDelete();

            // Held so a member can be listed and invited before any account exists.
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('job_title', 120)->nullable();

            // primary | finance | event | signatory | viewer | member
            $table->string('role', 24)->default('member');
            $table->boolean('is_primary')->default(false);

            $table->boolean('can_view_bookings')->default(false);
            $table->boolean('can_manage_bookings')->default(false);
            $table->boolean('can_view_files')->default(false);
            $table->boolean('can_upload_files')->default(false);
            $table->boolean('can_view_invoices')->default(false);
            $table->boolean('can_view_contracts')->default(false);
            $table->boolean('can_sign_contracts')->default(false);
            $table->boolean('can_invite_others')->default(false);

            // invited | active | removed
            $table->string('status', 16)->default('invited');

            $table->foreignId('added_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('removed_at')->nullable();
            $table->foreignId('removed_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->index(['company_id', 'status']);
            $table->index(['user_id', 'status']);
            $table->index('email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('company_members');
    }
};
