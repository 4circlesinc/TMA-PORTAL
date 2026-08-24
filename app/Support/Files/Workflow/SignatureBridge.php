<?php

namespace App\Support\Files\Workflow;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Files\Activity;
use App\Support\Files\Versions;
use App\Support\Signatures\Status as SigStatus;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Makes a signature request visible as a file workflow.
 *
 * The portal already has a complete, tested signing engine. Rather than
 * reimplementing signing inside the workflow tables, which would risk breaking
 * something that works, a signature request is *mirrored* into a workflow row
 * so the file viewer can show its status, its recipients' progress and its
 * badge exactly like any other request.
 *
 * The mirror is one-directional and derived. The signature engine remains the
 * authority: nothing here ever changes a request, a recipient, or a token.
 * Because the mirror is refreshed on read as well as on write, it can never
 * drift into showing a status the engine has since moved past.
 */
class SignatureBridge
{
    /** signature request status => the file-workflow status it reads as. */
    private const MAP = [
        SigStatus::DRAFT => Status::DRAFT,
        SigStatus::SENT => Status::AWAITING_SIGNATURE,
        SigStatus::VIEWED => Status::AWAITING_SIGNATURE,
        SigStatus::IN_PROGRESS => Status::PARTIALLY_SIGNED,
        SigStatus::COMPLETED => Status::SIGNED,
        SigStatus::DECLINED => Status::DECLINED,
        SigStatus::CHANGES_REQUESTED => Status::CHANGES_REQUESTED,
        SigStatus::CANCELLED => Status::CANCELLED,
        SigStatus::EXPIRED => Status::EXPIRED,
    ];

    /**
     * Create the mirror for a request that targets a library file, or refresh
     * the one that already exists. Safe to call as often as you like.
     */
    public static function sync(SignatureRequest $request): ?FileWorkflow
    {
        // A request built from an upload rather than a library file has nothing
        // to mirror onto.
        if (! $request->file_id) {
            return null;
        }

        try {
            $file = FileItem::find($request->file_id);
            if (! $file) {
                return null;
            }

            $workflow = FileWorkflow::where('signature_request_id', $request->id)->first();

            if (! $workflow) {
                Versions::recordInitial($file);
                $version = Versions::current($file);

                $workflow = FileWorkflow::create([
                    'uuid' => (string) Str::uuid(),
                    'file_id' => $file->id,
                    // Signing, like approval, is about one specific revision.
                    'file_version_id' => $version?->id,
                    'type' => Status::TYPE_SIGNATURE,
                    'status' => self::MAP[$request->status] ?? Status::DRAFT,
                    'created_by' => $request->created_by,
                    'message' => $request->message,
                    'due_at' => $request->expires_at,
                    'require_all' => true,
                    'ordered' => true,
                    'signature_request_id' => $request->id,
                ]);

                Activity::forFile($request->created_by, $file, 'signature-sent', [
                    'request' => $request->uuid,
                    'version' => $version?->version_number,
                ]);
            }

            $previous = $workflow->status;
            $mapped = self::MAP[$request->status] ?? $workflow->status;

            $workflow->update([
                'status' => $mapped,
                'due_at' => $request->expires_at,
                'completed_at' => $request->completed_at ?? $request->declined_at ?? $request->cancelled_at,
            ]);

            self::syncSteps($workflow, $request);

            // Record the outcome once, when it first becomes final.
            if ($previous !== $mapped && Status::isTerminal($mapped)) {
                self::recordOutcome($workflow->fresh(), $file, $request, $mapped);
            }

            return $workflow->fresh();
        } catch (\Throwable $e) {
            // Mirroring must never break signing. A viewer that shows a stale
            // status is a far smaller problem than a signature that fails.
            Log::error('SignatureBridge.sync failed', [
                'request' => $request->uuid ?? null,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /** Refresh a workflow that already points at a request. */
    public static function refresh(FileWorkflow $workflow): FileWorkflow
    {
        if ($workflow->type !== Status::TYPE_SIGNATURE || ! $workflow->signature_request_id) {
            return $workflow;
        }

        $request = SignatureRequest::find($workflow->signature_request_id);

        return $request ? (self::sync($request) ?? $workflow) : $workflow;
    }

    /**
     * Mirror the recipients, so the viewer shows who has signed and who has
     * not without having to understand the signing engine's own vocabulary.
     */
    private static function syncSteps(FileWorkflow $workflow, SignatureRequest $request): void
    {
        $recipients = SignatureRecipient::where('signature_request_id', $request->id)
            ->orderBy('signing_order')->orderBy('id')->get();

        foreach ($recipients as $recipient) {
            $step = FileWorkflowStep::where('workflow_id', $workflow->id)
                // Matched by email, never by position: recipients are synced by
                // email in the signing engine too, and re-creating steps would
                // lose their history.
                ->where('email', $recipient->email)
                ->first();

            $attrs = [
                'name' => $recipient->name,
                'role' => $recipient->role === 'approver' ? 'approver' : 'signer',
                'position' => (int) ($recipient->signing_order ?: 1),
                'status' => self::stepStatus($recipient),
                'comment' => $recipient->comment,
                'invited_at' => $recipient->invited_at,
                'responded_at' => $recipient->signed_at ?? $recipient->declined_at,
            ];

            if ($step) {
                $step->update($attrs);
            } else {
                FileWorkflowStep::create($attrs + [
                    'uuid' => (string) Str::uuid(),
                    'workflow_id' => $workflow->id,
                    'email' => $recipient->email,
                    'user_id' => User::where('email', $recipient->email)->value('id'),
                ]);
            }
        }
    }

    private static function stepStatus(SignatureRecipient $recipient): string
    {
        return match ($recipient->status) {
            'signed' => $recipient->role === 'approver' ? 'approved' : 'signed',
            'declined' => 'declined',
            'changes_requested' => 'changes_requested',
            'viewed' => 'invited',
            'sent' => 'invited',
            default => $recipient->invited_at ? 'invited' : 'pending',
        };
    }

    /**
     * When signing finishes, make it visible from the ORIGINAL file, not only
     * from the signed copy. Someone looking at the document they sent needs to
     * see that it was signed, and be able to reach the signed output.
     */
    private static function recordOutcome(FileWorkflow $workflow, FileItem $file, SignatureRequest $request, string $status): void
    {
        Activity::forFile($request->created_by, $file, match ($status) {
            Status::SIGNED => 'signed',
            Status::DECLINED => 'signature-declined',
            default => 'signature-sent',
        }, [
            'request' => $request->uuid,
            'signedFile' => $request->signedFile?->uuid,
        ]);

        if ($workflow->file_version_id) {
            FileVersion::where('id', $workflow->file_version_id)
                ->update(['approval_status' => $status]);
        }
    }

    /** The signed output for a workflow, for the viewer to link to. */
    public static function signedFileFor(FileWorkflow $workflow): ?array
    {
        if (! $workflow->signature_request_id) {
            return null;
        }

        $request = SignatureRequest::with('signedFile')->find($workflow->signature_request_id);
        $signed = $request?->signedFile;

        if (! $signed) {
            return null;
        }

        return [
            'id' => $signed->uuid,
            'name' => $signed->name,
            'downloadUrl' => route('files.download', $signed->uuid),
        ];
    }
}
