<?php

use App\Models\User;
use App\Support\Mail\SignatureImages;
use Illuminate\Database\Migrations\Migration;

/**
 * Take the pictures already sitting inside `users.preferences` and put them
 * in object storage.
 *
 * On this firm one account held a 2.6 MB logo as a `data:` URI, stored twice
 * (the active `signature` string and the one entry of the `signatures`
 * library), making its preferences row 5.4 MB against about a kilobyte for
 * everyone else. Every query that loaded that user decoded the lot: it was
 * 55ms of the 59ms presence board, and it was read on every dashboard poll
 * by every signed-in person.
 *
 * New signatures never take that shape — {@see SignatureImages::store()} runs
 * on the way in. This is for the rows already written.
 *
 * Rewriting only what is oversized, and only the signature keys, so an
 * account whose settings are already small is not touched at all.
 */
return new class extends Migration
{
    /** Rows smaller than this are not worth reading, let alone rewriting. */
    private const CONSIDER_OVER_BYTES = 65_536;

    public function up(): void
    {
        User::query()
            ->withTrashed()
            ->whereNotNull('preferences')
            ->select(['id', 'preferences'])
            ->chunkById(50, function ($users) {
                foreach ($users as $user) {
                    $preferences = $user->preferences;

                    if (! is_array($preferences) || ! is_array($preferences['mail'] ?? null)) {
                        continue;
                    }

                    if (strlen(json_encode($preferences) ?: '') < self::CONSIDER_OVER_BYTES) {
                        continue;
                    }

                    $mail = $preferences['mail'];
                    $before = $mail;

                    if (is_string($mail['signature'] ?? null)) {
                        $mail['signature'] = SignatureImages::store($mail['signature']);
                    }

                    if (is_array($mail['signatures'] ?? null)) {
                        foreach ($mail['signatures'] as $index => $entry) {
                            if (is_array($entry) && is_string($entry['html'] ?? null)) {
                                $mail['signatures'][$index]['html'] = SignatureImages::store($entry['html']);
                            }
                        }
                    }

                    if ($mail === $before) {
                        continue;
                    }

                    $preferences['mail'] = $mail;

                    // Written without touching updated_at: this is the same
                    // settings said a shorter way, not the person changing them.
                    User::withTrashed()
                        ->whereKey($user->id)
                        ->update(['preferences' => json_encode($preferences)]);
                }
            });
    }

    /**
     * Not reversible, and deliberately so.
     *
     * Down would mean reading every stored object back into base64 and
     * writing the megabytes back into the column — restoring a fault. The
     * objects stay where they are and the URLs keep resolving, so rolling
     * the migration back changes nothing a reader would notice.
     */
    public function down(): void {}
};
