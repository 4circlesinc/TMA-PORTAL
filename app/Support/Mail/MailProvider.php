<?php

namespace App\Support\Mail;

use App\Models\ConnectedAccount;

/**
 * What the portal needs from a mail backend, in the portal's own vocabulary.
 *
 * Gmail and Graph disagree about almost everything — Gmail has labels where
 * Graph has folders, Gmail syncs by historyId where Graph hands back a
 * deltaLink, Gmail wants a raw RFC822 blob where Graph wants JSON. All of
 * that is each implementation's problem; above this line a folder is a string
 * and a message is an array.
 */
interface MailProvider
{
    public static function for(ConnectedAccount $account): self;

    /**
     * Messages in a folder, newest first.
     *
     * @return array{messages: array<int, array<string, mixed>>, cursor: ?string}
     */
    public function listMessages(string $folder, int $limit = 50, ?string $pageToken = null): array;

    /**
     * Just what has landed in one folder since a moment in time.
     *
     * The "is there new mail?" question, and nothing else. A full incremental
     * sync walks every folder and pages through each — far too much to run on
     * a five-second timer, which is what a mailbox has to feel like. This is
     * one small request against one folder, so it can.
     *
     * It deliberately does not touch the sync cursor: the full pass stays the
     * authority on reads, moves and deletions, and this only ever *adds*
     * arrivals ahead of it. Re-reading the same message costs an idempotent
     * upsert; the cursor being wrong costs mail.
     *
     * @param  string  $since  ISO-8601 instant
     * @return array<int, array<string, mixed>>
     */
    public function newMessages(string $folder, string $since, int $limit = 25): array;

    /**
     * Everything the reading pane needs: bodies, recipients, attachment
     * metadata. Split from listMessages because bodies dominate the payload
     * and the list never shows them.
     *
     * @return array<string, mixed>
     */
    public function getMessage(string $remoteId): array;

    /** Raw attachment bytes, streamed to the browser without being stored. */
    public function getAttachment(string $remoteId, string $attachmentId): string;

    /**
     * Changes since `$cursor`, for incremental sync.
     *
     * @return array{messages: array<int, array<string, mixed>>, deleted: array<int, string>, cursor: ?string}
     */
    public function changesSince(?string $cursor): array;

    /**
     * @param  array<string, mixed>  $message
     * @return string the provider id of the sent message
     */
    public function send(array $message): string;

    /** @param array<string, mixed> $draft */
    public function saveDraft(array $draft, ?string $remoteId = null): string;

    public function deleteDraft(string $remoteId): void;

    public function markRead(string $remoteId, bool $read): void;

    public function star(string $remoteId, bool $starred): void;

    /**
     * Gmail's IMPORTANT marker. Outlook has no equivalent — its flag already
     * carries that meaning — so the Graph implementation is a no-op and
     * reports false back through `supportsImportant()`.
     */
    public function markImportant(string $remoteId, bool $important): void;

    public function supportsImportant(): bool;

    /** Move to a portal folder name (archive, trash, spam, inbox). */
    public function move(string $remoteId, string $folder): void;

    /** Permanently delete, bypassing Trash. */
    public function delete(string $remoteId): void;

    /** @return array<int, array{id: string, name: string, system: bool}> */
    public function listLabels(): array;

    public function setLabel(string $remoteId, string $labelId, bool $applied): void;

    /**
     * Provider-side search, so results cover the whole mailbox rather than
     * only what has been synced locally.
     *
     * @return array<int, array<string, mixed>>
     */
    public function search(string $query, int $limit = 50): array;

    /**
     * How many messages each folder holds at the provider. Used as the
     * denominator for backfill progress, so folders the provider does not
     * report are simply absent rather than guessed at.
     *
     * @return array<string, int> keyed by our folder names
     */
    public function folderTotals(): array;

    /**
     * How many messages in each folder carry attachments, where the provider
     * can answer cheaply. Used only for the initial "N attachments found"
     * estimate on the progress panel — a provider with no cheap answer
     * returns [] and the panel counts what the import actually finds instead.
     *
     * @return array<string, int> keyed by our folder names
     */
    public function attachmentCounts(): array;

    /**
     * That person's profile photo as raw image bytes, or null when the
     * provider has none for them (or will not share it). Providers only hold
     * photos for people inside the account's own organisation.
     */
    public function photoFor(string $email): ?string;
}
