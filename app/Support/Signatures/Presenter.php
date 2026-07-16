<?php

namespace App\Support\Signatures;

use App\Models\SignatureField;
use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use App\Models\User;

/**
 * Shapes signature requests into safe JSON for the client. Only public uuids
 * are exposed - never database ids, storage paths, or signing tokens. The
 * `permissions` map is computed here so the UI never has to infer which
 * actions a status allows.
 */
class Presenter
{
    public function __construct(private User $viewer) {}

    /**
     * @param  SignatureRequest[]  $requests
     * @return array<int, array>
     */
    public function collection(array $requests): array
    {
        return array_map(fn (SignatureRequest $r) => $this->request($r), $requests);
    }

    public function request(SignatureRequest $request, bool $withDetail = false): array
    {
        $recipients = $request->relationLoaded('recipients')
            ? $request->recipients->all()
            : $request->recipients()->get()->all();

        $signed = count(array_filter(
            $recipients,
            fn (SignatureRecipient $r) => $r->status === 'signed',
        ));
        $total = count(array_filter(
            $recipients,
            fn (SignatureRecipient $r) => $r->role !== 'cc',
        ));

        $data = [
            'id' => $request->uuid,
            'title' => $request->title,
            'status' => $request->status,
            'statusLabel' => Status::label($request->status),
            'subject' => $request->subject,
            'autoDeleteDays' => (int) $request->auto_delete_days,
            'recipients' => array_map(fn (SignatureRecipient $r) => $this->recipient($r), $recipients),
            'progress' => [
                'signed' => $signed,
                'total' => $total,
                // A request with only CC recipients has nothing to complete;
                // report 0 rather than dividing by zero.
                'percent' => $total > 0 ? (int) round(($signed / $total) * 100) : 0,
            ],
            'document' => $request->file ? [
                'id' => $request->file->uuid,
                'name' => $request->file->name,
            ] : null,
            'signedDocument' => $request->signedFile ? [
                'id' => $request->signedFile->uuid,
                'name' => $request->signedFile->name,
            ] : null,
            'folder' => $request->folder ? [
                'id' => $request->folder->uuid,
                'name' => $request->folder->name,
            ] : null,
            'createdBy' => $this->person($request->creator),
            'createdAt' => optional($request->created_at)->toIso8601String(),
            'sentAt' => optional($request->sent_at)->toIso8601String(),
            'completedAt' => optional($request->completed_at)->toIso8601String(),
            'declinedAt' => optional($request->declined_at)->toIso8601String(),
            'cancelledAt' => optional($request->cancelled_at)->toIso8601String(),
            'expiresAt' => optional($request->expires_at)->toIso8601String(),
            'permissions' => $this->permissions($request),
        ];

        if ($withDetail) {
            $data['message'] = $request->message;
            $data['events'] = $this->events($request);
        }

        return $data;
    }

    public function recipient(SignatureRecipient $recipient): array
    {
        return [
            'id' => $recipient->uuid,
            'name' => $recipient->name,
            'email' => $recipient->email,
            'role' => $recipient->role,
            'order' => (int) $recipient->signing_order,
            'status' => $recipient->status,
            'statusLabel' => ucfirst($recipient->status),
            'initials' => self::initials($recipient->name ?: $recipient->email),
            'viewedAt' => optional($recipient->viewed_at)->toIso8601String(),
            'signedAt' => optional($recipient->signed_at)->toIso8601String(),
            'declinedAt' => optional($recipient->declined_at)->toIso8601String(),
            'declineReason' => $recipient->decline_reason,
        ];
    }

    /**
     * Placed fields, keyed to recipients by public uuid so the editor never
     * sees a database id.
     *
     * @return array<int, array>
     */
    public function fields(SignatureRequest $request): array
    {
        $fields = $request->relationLoaded('fields')
            ? $request->fields->all()
            : $request->fields()->with('recipient')->get()->all();

        return array_map(fn (SignatureField $f) => [
            'id' => $f->uuid,
            'type' => $f->type,
            'label' => FieldType::label($f->type),
            'recipient' => $f->recipient?->uuid,
            'page' => (int) $f->page,
            'x' => (float) $f->x,
            'y' => (float) $f->y,
            'width' => (float) $f->width,
            'height' => (float) $f->height,
            'required' => (bool) $f->required,
            'autofilled' => FieldType::isAutofilled($f->type),
            'completedAt' => optional($f->completed_at)->toIso8601String(),
        ], $fields);
    }

    /** @return array<int, array> */
    private function events(SignatureRequest $request): array
    {
        return $request->events()->with('recipient', 'user')->get()->map(fn ($e) => [
            'action' => $e->action,
            'actor' => $e->recipient?->email ?? $e->user?->name,
            'meta' => $e->meta,
            'ip' => $e->ip,
            'at' => optional($e->created_at)->toIso8601String(),
        ])->all();
    }

    private function permissions(SignatureRequest $request): array
    {
        $owns = $request->created_by === $this->viewer->id;

        return [
            'open' => true,
            'edit' => $owns && $request->status === Status::DRAFT,
            'delete' => $owns && Status::isDeletable($request->status),
            'cancel' => $owns && Status::isCancellable($request->status),
            'remind' => $owns && $request->isPending(),
            'duplicate' => $owns,
            'downloadOriginal' => $request->file !== null,
            'downloadSigned' => $request->signed_file_id !== null,
        ];
    }

    private function person(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar_url,
        ];
    }

    public static function initials(string $name): string
    {
        $parts = array_values(array_filter(preg_split('/\s+/', trim($name)) ?: []));
        if (! $parts) {
            return '';
        }

        return strtoupper(implode('', array_map(
            fn ($p) => mb_substr($p, 0, 1),
            array_slice($parts, 0, 2),
        )));
    }
}
