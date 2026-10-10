<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FileValidationException;
use App\Support\Files\FolderTree;
use App\Support\Files\Naming;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Move a CIP file (and its Add-On family) from one service provider to another.
 *
 * The firm chosen at intake stamps the number prefix and used to be immutable.
 * Administrators may still hand a filed application to a different firm when
 * the case genuinely changes hands. Doing so must also reparent the client
 * folder under the destination firm's Citizenship Applications drawer —
 * otherwise the old firm keeps seeing the papers in the File Library while
 * ApplicationScope has already cut them off the caseload.
 *
 * THE NUMBER FOLLOWS THE FIRM
 *
 * The application number is the firm's code and that firm's sequence, so a
 * file that changes firm is numbered again under the new one: GAL26-00001
 * moved to IGA becomes IGA's next number. It used to keep the old number,
 * which left a file listed under one firm wearing another's code. The number
 * it leaves behind is not reissued, stays in the audit row that records the
 * move, and stays searchable ({@see Applications::previouslyNumbered}); what
 * was already sent citing it is history and is not rewritten. The Unit's CIP
 * number is a different thing and never moves with the firm.
 *
 * {@see rehome} is the one writer of an application's firm after creation.
 * The administrator's transfer, a draft whose form names another firm, and
 * an Add-On adopting its parent's firm all come through it, so the firm, the
 * number, the hub referral, the folder and the audit row cannot drift apart.
 */
final class ProviderTransfer
{
    /** Audit `reason`: an Add-On took its main application's firm. */
    public const REASON_PARENT_LINKED = 'parent_linked';

    /** Audit `reason`: an unfiled draft's form named another firm. */
    public const REASON_DRAFT_FORM = 'draft_form';

    /**
     * Hand this application (and every Add-On that hangs off the same parent)
     * to another service provider.
     *
     * @return list<CipApplication> The applications that moved.
     */
    public static function transfer(
        CipApplication $application,
        CipProvider $to,
        User $actor,
        bool $confirmed,
    ): array {
        if (! CipAccess::canTransferProvider($actor)) {
            abort(403, 'Only an administrator can transfer an application to another service provider.');
        }

        if (! $confirmed) {
            throw ValidationException::withMessages([
                'confirm' => 'Confirm that the application folder will move and the current service provider will lose access.',
            ]);
        }

        $application->loadMissing(['provider', 'client.folder', 'parent']);

        if ((int) $application->provider_id === (int) $to->id) {
            throw ValidationException::withMessages([
                'providerId' => 'That firm already holds this application.',
            ]);
        }

        if (! $to->active) {
            throw ValidationException::withMessages([
                'providerId' => 'That service provider is not active.',
            ]);
        }

        $family = self::family($application);

        // Notify both firms' contacts: the leavers lose the file, the arrivals
        // gain it. Collected before the write so the old provider_id is still
        // what Contacts reads for the outgoing side.
        $notify = Contacts::providerUserIds($application);
        foreach ($family as $member) {
            $notify = array_values(array_unique(array_merge(
                $notify,
                Contacts::providerUserIds($member),
            )));
        }

        Providers::ensureFolder($to);
        $to->refresh();

        $moved = DB::transaction(function () use ($family, $to, $actor) {
            $out = [];

            foreach ($family as $member) {
                if ($rehomed = self::rehome($member, $to, $actor)) {
                    $out[] = $rehomed;
                }
            }

            return $out;
        });

        // Arriving firm contacts, after the write.
        foreach ($moved as $member) {
            $notify = array_values(array_unique(array_merge(
                $notify,
                Contacts::providerUserIds($member),
            )));
        }

        Live::staffAnd(Live::CIP, $notify);
        Live::staff(Live::CLIENTS);
        Live::staff(Live::COMPANIES);
        Live::staff(Live::FILES);

        return $moved;
    }

    /**
     * Put one application under another firm.
     *
     * Five things that are one fact, written together under the row's lock:
     * the firm, a number under that firm's code, the hub referral, the
     * client folder's place in the library, and the audit row naming both
     * firms and both numbers. Answers null when the application is already
     * there, so a double submit or two doors racing mint nothing twice.
     *
     * No permission is asked here: who may move a filed application is
     * {@see transfer}'s question, and the other callers are moving a file
     * that is still being typed. `$meta` is added to the audit row, for a
     * caller that has a reason worth keeping.
     *
     * Opens its own transaction, so it is safe alone and nests inside a
     * caller's. A refused folder move rolls the firm, the number and the
     * counter back with it.
     *
     * @param  array<string, mixed>  $meta
     */
    public static function rehome(
        CipApplication $application,
        CipProvider $to,
        ?User $actor,
        array $meta = [],
    ): ?CipApplication {
        return DB::transaction(function () use ($application, $to, $actor, $meta) {
            $member = CipApplication::query()
                ->whereKey($application->id)
                ->lockForUpdate()
                ->first();

            if ($member === null || (int) $member->provider_id === (int) $to->id) {
                return null;
            }

            $member->loadMissing(['provider', 'client.folder']);

            $from = $member->provider;
            $previousNumber = (string) $member->internal_number;
            $number = Applications::numberUnder($member, $to);

            // One write for both, through the model: the sync cursor reads
            // updated_at, and a row is never seen under one firm wearing
            // the other's number.
            $member->forceFill([
                'provider_id' => $to->id,
                'internal_number' => $number,
            ])->save();
            $member->setRelation('provider', $to);

            self::syncClient($member, $to, $from?->company_id);
            self::reparentClientFolder($member, $to);
            // After the move, so a renamed folder is made unique among the
            // siblings it will actually sit beside.
            Tree::followNumber($member, $previousNumber);

            Engine::record($member, CipEvent::ACTION_PROVIDER_TRANSFERRED, $actor, array_merge([
                'fromProvider' => $from?->name ?: 'the previous firm',
                'fromProviderId' => $from?->uuid,
                'toProvider' => $to->name,
                'toProviderId' => $to->uuid,
                'folderMoved' => (bool) ($member->client?->folder_id),
            ], $number !== $previousNumber ? [
                // The same two keys every number change writes, so one key
                // answers "what did this file used to be called".
                'previousInternalNumber' => $previousNumber,
                'internalNumber' => $number,
            ] : [], $meta));

            return $member->fresh(['provider', 'client']);
        });
    }

    /**
     * Parent plus every Add-On, so a family never straddles two firms.
     *
     * @return list<CipApplication>
     */
    public static function family(CipApplication $application): array
    {
        $root = $application->parent_application_id
            ? ($application->parent ?: CipApplication::query()->find($application->parent_application_id))
            : $application;

        if (! $root) {
            return [$application];
        }

        $children = CipApplication::query()
            ->where('parent_application_id', $root->id)
            ->orderBy('id')
            ->get();

        return $children->prepend($root)->unique('id')->values()->all();
    }

    /**
     * Keep the hub referral column pointing at the firm that now holds the file.
     *
     * Referral only — never `company_id`. That column is membership (Provider
     * contacts / people at the firm). Stamping the filing firm there used to
     * put applicants on the Provider contacts card next to the real contacts.
     */
    private static function syncClient(CipApplication $application, CipProvider $to, ?int $fromFirmId = null): void
    {
        $client = $application->client;
        if (! $client) {
            return;
        }

        $patch = [
            'company' => $to->name,
        ];

        if ($to->company_id) {
            $patch['referral_type'] = Client::REFERRAL_COMPANY;
            $patch['referred_by_company_id'] = $to->company_id;
        }

        // Drop mistaken membership if a past transfer or fixture left the
        // applicant belonging to either the outgoing or incoming firm.
        $mistaken = array_values(array_filter([(int) $to->company_id, (int) $fromFirmId]));
        if ($client->company_id && in_array((int) $client->company_id, $mistaken, true)) {
            $patch['company_id'] = null;
        }

        $client->forceFill($patch)->save();
    }

    /**
     * Reparent the client's CIP drawer under the destination firm's folder.
     *
     * No-op when the destination has no Citizenship Applications folder yet
     * (a fresh install / test rig), or when the client folder is already
     * sitting there. Name collisions under the new parent are resolved by
     * appending " (2)" rather than refusing the transfer.
     *
     * Also used when an Add-On draft links its parent and inherits that
     * firm's provider_id — without this the papers stay under the Dropbox
     * drawer the draft was first opened in.
     */
    public static function reparentClientFolder(CipApplication $application, CipProvider $to): void
    {
        $client = $application->client;
        $folder = $client?->folder;
        $destination = $to->folder;

        if (! $folder || ! $destination) {
            return;
        }

        if ((int) $folder->parent_id === (int) $destination->id) {
            return;
        }

        self::ensureUniqueName($folder, $destination);

        try {
            FolderTree::move($folder, $destination);
        } catch (FileValidationException $e) {
            throw ValidationException::withMessages([
                'providerId' => $e->getMessage(),
            ]);
        }
    }

    private static function ensureUniqueName(Folder $folder, Folder $destination): void
    {
        $taken = Folder::query()
            ->where('parent_id', $destination->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($folder->name)])
            ->where('id', '!=', $folder->id)
            ->exists();

        if (! $taken) {
            return;
        }

        $name = Naming::nextAvailable(
            Naming::clean($folder->name) ?: 'Client',
            fn ($candidate) => Folder::query()
                ->where('parent_id', $destination->id)
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
                ->where('id', '!=', $folder->id)
                ->exists()
        );

        $folder->forceFill(['name' => $name])->save();
    }
}
