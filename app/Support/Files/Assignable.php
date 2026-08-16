<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;

/**
 * Who an item can be assigned to, for a picker that lists people rather than
 * asking for an email.
 *
 * The rule is {@see CommentPresenter::mentionable}'s, because it is the same
 * question: naming somebody on an item lets them in, so who a reader may name
 * is who a reader may admit.
 *
 *  - **Staff who can share it see everybody**, since they can bring anyone in
 *    anyway. Restricting the list to people who already hold the item would
 *    hide exactly the colleague the picker was opened to find.
 *  - **Everybody else sees only people who can already open it**, so a picker
 *    never becomes a directory of names the reader has no other way to see.
 *    A client can hold `full` over their own upload, and the answer to "who
 *    else is in this portal?" is not theirs to browse — the firm's other
 *    clients are on that list.
 *
 * `hasAccess` travels with each person so the picker can say, before the
 * reader commits, whether this actually changes anything.
 */
class Assignable
{
    /** Enough to choose from without becoming a directory to scroll. */
    private const LIMIT = 12;

    /**
     * @return list<array{id:int,name:string,email:string,avatar:string,hasAccess:bool}>
     */
    public static function people(FileItem|Folder $item, User $viewer, string $query = ''): array
    {
        $mayAddAnyone = FileAccess::isStaff($viewer) && FileAccess::can($viewer, 'share', $item);

        return User::query()
            ->where('status', User::STATUS_APPROVED)
            ->where('id', '!=', $viewer->id)
            ->when($query !== '', function ($q) use ($query) {
                // LOWER(...) LIKE, not ILIKE: production is Postgres, tests are
                // SQLite, and ILIKE does not exist there.
                $like = '%'.strtolower($query).'%';
                $q->where(function ($w) use ($like) {
                    $w->whereRaw('LOWER(name) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(email) LIKE ?', [$like]);
                });
            })
            ->orderBy('name')
            ->limit(60)
            ->get()
            ->map(fn (User $u) => ['user' => $u, 'access' => self::role($u, $item)])
            ->filter(fn (array $c) => $mayAddAnyone || $c['access'] !== null)
            /*
             * People who do NOT already hold it first.
             *
             * The opposite order to the mention composer, and deliberately:
             * that one is finding somebody to talk to about a file they are
             * probably already on, this one is granting access, and the names
             * worth showing first are the ones the action would do something
             * for.
             */
            ->sortBy(fn (array $c) => [$c['access'] === null ? 0 : 1, $c['user']->name])
            ->take(self::LIMIT)
            ->map(fn (array $c) => [
                'id' => $c['user']->id,
                'name' => $c['user']->name,
                'email' => $c['user']->email,
                'avatar' => $c['user']->photoUrl(),
                'hasAccess' => $c['access'] !== null,
            ])
            ->values()
            ->all();
    }

    /** A file and a folder are separate doors; ask the right one. */
    private static function role(User $user, FileItem|Folder $item): ?string
    {
        return $item instanceof FileItem
            ? FileAccess::fileRole($user, $item)
            : FileAccess::folderRole($user, $item);
    }
}
