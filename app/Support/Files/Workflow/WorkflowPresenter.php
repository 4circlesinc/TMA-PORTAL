<?php

namespace App\Support\Files\Workflow;

use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowEvent;
use App\Models\FileWorkflowStep;
use App\Models\User;

class WorkflowPresenter
{
    /** Everything the viewer's Approvals tab needs for one file. */
    public static function forFile(FileItem $file, User $viewer): array
    {
        $workflows = FileWorkflow::where('file_id', $file->id)
            ->with([
                'sender:id,name,email,avatar_url,provider_avatar_url',
                'version:id,version_number',
                'supersededByVersion:id,version_number',
                'steps.user:id,name,email,avatar_url,provider_avatar_url',
            ])
            ->orderByDesc('id')
            ->limit(20)
            ->get();

        // Signature workflows are mirrors; refresh them from the signing
        // engine before presenting so the panel is never stale.
        foreach ($workflows as $w) {
            if ($w->type === Status::TYPE_SIGNATURE) {
                SignatureBridge::refresh($w);
            }
        }
        $workflows = $workflows->fresh(['sender', 'version', 'supersededByVersion', 'steps.user']);

        return [
            'canSend' => Engine::canSend($viewer, $file),
            'badge' => self::badge($file),
            'lockReason' => \App\Support\Files\Versions::lockReason($file),
            'workflows' => $workflows->map(fn (FileWorkflow $w) => self::workflow($w, $viewer))->values(),
        ];
    }

    /** The status badge for a file — §23. Null when nothing has been sent. */
    public static function badge(FileItem $file): ?array
    {
        $workflow = Engine::activeFor($file);
        if (! $workflow) {
            return null;
        }

        return [
            'status' => $workflow->status,
            'label' => Status::label($workflow->status),
            'tone' => Status::tone($workflow->status),
            'type' => $workflow->type,
            // §23: the badge must describe the CURRENT version. When a newer
            // version has been uploaded since, the badge says so rather than
            // implying the file as it stands today was approved.
            'appliesToVersion' => $workflow->version?->version_number,
            'stale' => $workflow->superseded_by_version_id !== null,
        ];
    }

    public static function workflow(FileWorkflow $workflow, User $viewer): array
    {
        $mine = Engine::stepFor($workflow, $viewer);

        return [
            'id' => $workflow->uuid,
            'type' => $workflow->type,
            'status' => $workflow->status,
            'statusLabel' => Status::label($workflow->status),
            'tone' => Status::tone($workflow->status),
            'message' => $workflow->message,
            'dueAt' => optional($workflow->due_at)->toIso8601String(),
            'overdue' => $workflow->due_at !== null
                && $workflow->due_at->isPast()
                && ! Status::isTerminal($workflow->status),
            'requireAll' => (bool) $workflow->require_all,
            'ordered' => (bool) $workflow->ordered,
            'requireComment' => (bool) $workflow->require_comment,
            'lockFile' => (bool) $workflow->lock_file,
            'reminderDays' => $workflow->reminder_days,
            'version' => $workflow->version?->version_number,
            'supersededBy' => $workflow->supersededByVersion?->version_number,
            'sentAt' => optional($workflow->created_at)->toIso8601String(),
            'completedAt' => optional($workflow->completed_at)->toIso8601String(),
            'sender' => $workflow->sender ? [
                'name' => $workflow->sender->name,
                'avatar' => $workflow->sender->photoUrl(),
            ] : null,
            'steps' => $workflow->steps->map(fn (FileWorkflowStep $s) => self::step($s))->values(),
            // Where to find the signed output, once there is one.
            'signedFile' => $workflow->type === Status::TYPE_SIGNATURE
                ? SignatureBridge::signedFileFor($workflow)
                : null,
            // What THIS viewer can do about it right now.
            'myStep' => $mine ? $mine->uuid : null,
            'myActions' => $mine ? Status::actionsFor($workflow->type) : [],
            'canManage' => Engine::canManage($viewer, $workflow),
            'isOpen' => ! Status::isTerminal($workflow->status),
        ];
    }

    private static function step(FileWorkflowStep $step): array
    {
        return [
            'id' => $step->uuid,
            'name' => $step->user?->name ?? $step->name ?? $step->email,
            'email' => $step->user?->email ?? $step->email,
            'avatar' => $step->user?->photoUrl(),
            'role' => $step->role,
            'position' => $step->position,
            'status' => $step->status,
            'statusLabel' => match ($step->status) {
                'pending' => 'Not yet asked',
                'invited' => 'Waiting',
                'approved' => 'Approved',
                'declined' => 'Declined',
                'changes_requested' => 'Requested changes',
                'acknowledged' => 'Acknowledged',
                'responded' => 'Responded',
                'signed' => 'Signed',
                default => ucfirst(str_replace('_', ' ', $step->status)),
            },
            'comment' => $step->comment,
            'respondedAt' => optional($step->responded_at)->toIso8601String(),
            'delegatedFrom' => $step->delegated_from_id ? true : false,
            'reminderCount' => (int) $step->reminder_count,
        ];
    }

    /** The workflow's own audit trail, oldest first — §6 "Workflow History". */
    public static function history(FileWorkflow $workflow): array
    {
        return FileWorkflowEvent::where('workflow_id', $workflow->id)
            ->with('actor:id,name,avatar_url,provider_avatar_url')
            ->orderBy('id')
            ->get()
            ->map(fn (FileWorkflowEvent $e) => [
                'action' => $e->action,
                'detail' => $e->detail,
                'meta' => $e->meta,
                'at' => optional($e->created_at)->toIso8601String(),
                'actor' => $e->actor ? ['name' => $e->actor->name, 'avatar' => $e->actor->photoUrl()] : null,
            ])
            ->values()
            ->all();
    }
}
