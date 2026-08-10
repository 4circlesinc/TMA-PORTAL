<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Share;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use Illuminate\Support\Str;

/**
 * Adding somebody to a file they cannot open yet.
 *
 * Naming a colleague in a comment, or asking them to approve a document, used
 * to require that the file had already been shared with them: the mention was
 * silently dropped, the review request refused with "share it with them first".
 * That made the two most natural ways of pulling somebody in fail for exactly
 * the case they exist for — "can you look at this?" is most useful aimed at
 * somebody who has *not* seen it — and left the sender to go and arrange
 * access in a different panel before they could ask their question.
 *
 * The rule now: **whoever may share the file may add anyone to it**, whether or
 * not that person is assigned to the client, a member of the folder, or has
 * ever seen the file. Access follows the invitation instead of having to be
 * arranged ahead of it.
 *
 * Three things keep that from being a hole:
 *
 *  - **The granter must hold `share` themselves.** That is the same permission
 *    the Access panel demands, so this adds no reach that the person did not
 *    already have — it only saves them a detour. A viewer who was invited to
 *    comment cannot pull in strangers.
 *  - **The grant is the smallest one that works** — `viewer`, enough to open
 *    the file and reply to what they were asked, and nothing more. Anybody who
 *    needs more can be given it in the Access panel, deliberately.
 *  - **It is written down.** A row in Access with the granter's name on it, an
 *    entry in the file's activity, and an entry in the portal-wide log — so
 *    access that appeared because of a mention is as visible, and as revocable,
 *    as access somebody granted by hand.
 *
 * Nothing here notifies: the mention or the review request that prompted it is
 * already on its way, and it says far more than "a file was shared with you"
 * would. Two notifications for one act would read as a bug.
 */
class AccessGrants
{
    /** The least access that makes an invitation actionable: open it, reply. */
    public const ROLE = 'viewer';

    /**
     * Make sure this person can open the file, granting access if they can't.
     *
     * @param  string  $reason  why they were added — 'mention', 'review', 'delegation'
     * @return string|null the role they now hold, or null when the granter is
     *                     not allowed to give them one
     */
    public static function ensure(User $granter, User $person, FileItem $file, string $reason): ?string
    {
        $role = FileAccess::fileRole($person, $file);

        if ($role !== null) {
            return $role;
        }

        // Not a rule about who may be added, but about who may do the adding.
        if (! FileAccess::can($granter, 'share', $file)) {
            return null;
        }

        self::share($granter, $person, $file);

        Activity::forFile($granter->id, $file, 'assign', [
            'to' => $person->email,
            'role' => self::ROLE,
            'reason' => $reason,
        ]);

        ActivityLogger::log([
            'actor' => $granter,
            'type' => 'file.shared',
            'description' => $granter->name.' gave '.$person->name.' access to "'.$file->name.
                '" by adding them to it',
            'subject' => $file,
            'new' => ['role' => self::ROLE, 'reason' => $reason],
        ]);

        return self::ROLE;
    }

    /**
     * The share row itself.
     *
     * An existing row is reused rather than duplicated — including one that has
     * expired, which is revived rather than left in place beside a new row that
     * says something different about the same person.
     */
    private static function share(User $granter, User $person, FileItem $file): void
    {
        $share = Share::query()
            ->where('item_type', 'file')
            ->where('item_id', $file->id)
            ->where('kind', 'user')
            ->where('target_user_id', $person->id)
            ->whereNull('revoked_at')
            ->first();

        if ($share) {
            // Only the expiry is cleared. A role somebody chose deliberately is
            // left alone: this is here to make the file openable, not to
            // quietly downgrade an editor to a viewer.
            $share->update(['expires_at' => null]);

            return;
        }

        Share::create([
            'uuid' => (string) Str::uuid(),
            'token' => Sharing::token(),
            'item_type' => 'file',
            'item_id' => $file->id,
            'shared_by' => $granter->id,
            'kind' => 'user',
            'target_user_id' => $person->id,
            'role' => self::ROLE,
            'allow_download' => true,
        ]);
    }
}
