<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Append-only audit trail for a signature request. Rows are never updated
     * or deleted while the request lives - they are the evidence of who did
     * what, when, and from where.
     */
    public function up(): void
    {
        Schema::create('signature_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('signature_request_id')->constrained('signature_requests')->cascadeOnDelete();
            $table->foreignId('signature_recipient_id')->nullable()
                ->constrained('signature_recipients')->nullOnDelete();
            // The portal user who acted, when it wasn't a recipient.
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

            // created|sent|reminded|viewed|field_completed|signed|completed
            // |declined|cancelled|expired|downloaded
            $table->string('action', 24);
            $table->jsonb('meta')->nullable();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index('signature_request_id');
            $table->index('signature_recipient_id');
            $table->index('action');
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('signature_events');
    }
};
