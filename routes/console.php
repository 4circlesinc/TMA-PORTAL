<?php

use App\Support\Files\ChunkedUpload;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
 * Remove abandoned/expired chunked-upload sessions and their orphaned temp
 * parts so half-finished uploads never linger as junk on disk or in the table.
 */
Artisan::command('files:cleanup-uploads', function () {
    $removed = ChunkedUpload::cleanupExpired();
    $this->info("Removed {$removed} expired upload session(s).");
})->purpose('Clean up expired file-upload sessions');

Schedule::command('files:cleanup-uploads')->hourly();
