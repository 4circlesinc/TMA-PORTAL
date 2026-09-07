<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-field typography for the signature editor.
 *
 * Font size was derived from the field's height and nothing else, so the only
 * way to make text bigger was to draw a taller box. Both columns are nullable
 * on purpose: null means "as before" — the size fitted to the field's height,
 * and left alignment — so every field placed before this keeps rendering
 * exactly as it already does.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('signature_fields', function (Blueprint $table) {
            // Points, matching the stamper's own unit. Null = fit to height.
            $table->decimal('font_size', 5, 2)->nullable()->after('height');
            // left | center | right. Null = left, the previous behaviour.
            $table->string('align', 6)->nullable()->after('font_size');
        });
    }

    public function down(): void
    {
        Schema::table('signature_fields', function (Blueprint $table) {
            $table->dropColumn(['font_size', 'align']);
        });
    }
};
