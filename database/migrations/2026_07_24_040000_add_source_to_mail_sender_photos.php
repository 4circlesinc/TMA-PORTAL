<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Track whether a cached sender image is a real face (directory / Gravatar)
 * or a company brand favicon. Notification avatars must never use brand
 * logos — they crop into weird slivers in a circular face slot.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('mail_sender_photos', function (Blueprint $table) {
            $table->string('source', 20)->nullable()->after('has_photo');
        });

        // Existing icon/gif rows are brand favicons. PNG/JPEG without a source
        // stay null until the next resolve rewrites them — notification code
        // only treats jpeg (and explicit directory/gravatar) as a face.
        DB::table('mail_sender_photos')
            ->where('has_photo', true)
            ->where(function ($q) {
                $q->where('mime', 'like', '%icon%')
                    ->orWhere('mime', 'image/gif')
                    ->orWhere('path', 'like', '%.ico');
            })
            ->update(['source' => 'brand']);
    }

    public function down(): void
    {
        Schema::table('mail_sender_photos', function (Blueprint $table) {
            $table->dropColumn('source');
        });
    }
};
