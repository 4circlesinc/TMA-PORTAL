<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One request, several checklist documents.
 *
 * A request could already be aimed at one checklist slot (`document_id`).
 * Asking a service provider for the Oath of Allegiance, the proof of payment
 * and a passport photo meant three links, three emails, three pages. A
 * request now carries a list: each row is one document it asks for, and
 * which file answered it once it has been uploaded.
 *
 * `recipient_user_id` names the portal account a request was sent to, when
 * it went to somebody who has one — that is who is notified in the portal as
 * well as by email, and the upload page then does not ask who they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('file_request_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('file_request_id')->constrained('file_requests')->cascadeOnDelete();
            $table->foreignId('document_id')->constrained('cip_documents')->cascadeOnDelete();
            $table->foreignId('file_id')->nullable()->constrained('files')->nullOnDelete();
            $table->timestamp('uploaded_at')->nullable();
            $table->timestamps();
            $table->unique(['file_request_id', 'document_id']);
        });

        Schema::table('file_requests', function (Blueprint $table) {
            $table->foreignId('recipient_user_id')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('file_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('recipient_user_id');
        });

        Schema::dropIfExists('file_request_documents');
    }
};
