<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('signature_fields', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('signature_request_id')->constrained('signature_requests')->cascadeOnDelete();
            // Null only while drafting - a field must be assigned before send.
            $table->foreignId('signature_recipient_id')->nullable()
                ->constrained('signature_recipients')->cascadeOnDelete();

            // signature|initials|name|email|date|text|checkbox
            $table->string('type', 16);
            $table->unsignedSmallInteger('page')->default(1); // 1-based

            // Page-relative fractions (0..1) of page width/height, so placement
            // survives any zoom or render scale between the editor and stamping.
            $table->decimal('x', 9, 6);
            $table->decimal('y', 9, 6);
            $table->decimal('width', 9, 6);
            $table->decimal('height', 9, 6);

            $table->boolean('required')->default(true);
            $table->text('value')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index('signature_request_id');
            $table->index('signature_recipient_id');
            $table->index(['signature_request_id', 'page']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('signature_fields');
    }
};
