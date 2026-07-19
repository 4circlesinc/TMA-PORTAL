<?php

namespace App\Support\Signatures;

use App\Models\SignatureEvent;
use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use Illuminate\Support\Facades\Request;

/**
 * Writes the signature audit trail. One call per meaningful action. Recipient
 * actions carry the request's IP and user agent because that evidence is the
 * point of the trail - a signature nobody can place is not worth much.
 */
class Activity
{
    public const CREATED = 'created';

    public const SENT = 'sent';

    public const REMINDED = 'reminded';

    public const VIEWED = 'viewed';

    public const FIELD_COMPLETED = 'field_completed';

    public const SIGNED = 'signed';

    public const COMPLETED = 'completed';

    public const DECLINED = 'declined';

    public const APPROVED = 'approved';

    public const CHANGES_REQUESTED = 'changes_requested';

    public const CANCELLED = 'cancelled';

    public const EXPIRED = 'expired';

    public const DOWNLOADED = 'downloaded';

    /** An action taken by a signed-in portal user. */
    public static function log(
        SignatureRequest $request,
        string $action,
        ?int $userId = null,
        array $meta = [],
    ): void {
        self::write($request->id, $action, $userId, null, $meta);
    }

    /** An action taken by a recipient through a signing link. */
    public static function forRecipient(
        SignatureRecipient $recipient,
        string $action,
        array $meta = [],
    ): void {
        self::write(
            $recipient->signature_request_id,
            $action,
            null,
            $recipient->id,
            array_merge(['recipient' => $recipient->email], $meta),
        );
    }

    private static function write(
        int $requestId,
        string $action,
        ?int $userId,
        ?int $recipientId,
        array $meta,
    ): void {
        SignatureEvent::create([
            'signature_request_id' => $requestId,
            'signature_recipient_id' => $recipientId,
            'user_id' => $userId,
            'action' => $action,
            'meta' => $meta ?: null,
            'ip' => Request::ip(),
            'user_agent' => substr((string) Request::userAgent(), 0, 255) ?: null,
            'created_at' => now(),
        ]);
    }
}
