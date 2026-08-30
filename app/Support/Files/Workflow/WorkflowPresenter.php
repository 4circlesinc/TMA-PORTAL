<?php

namespace App\Support\Files\Workflow;

use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowEvent;
use App\Models\FileWorkflowStep;
use App\Models\User;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\Versions;

class WorkflowPresenter
{
    /** Everything the viewer's Approvals tab needs for one file. */
    public static function forFile(FileItem $file, User $viewer): array
    {
        $workflows = FileWorkflow::where('file_id', $file->id)
            ->with([
                'sender',
                'senderMember',
                'version:id,version_number',
                'supersededByVersion:id,version_number',
                'steps.user',
                'steps.companyMember',
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
        $workflows = $workflows->fresh(['sender', 'senderMember', 'version', 'supersededByVersion', 'steps.user', 'steps.companyMember']);

        return [
            'canSend' => Engine::canSend($viewer, $file),
            'badge' => self::badge($file),
            'lockReason' => Versions::lockReason($file),
            'workflows' => $workflows->map(fn (FileWorkflow $w) => self::workflow($w, $viewer))->values(),
            /*
             * Counted, not measured off the list above.
             *
             * That list is capped at the twenty most recent and shaped for
             * reading; the tab label is a claim about the whole file. They are
             * the same numbers the details payload reports, so the tab keeps
             * saying the same thing after a request is sent, answered or
             * cancelled, which it did not when only /details knew the count.
             */
            'openCount' => FileWorkflow::where('file_id', $file->id)
                ->whereNotIn('status', Status::TERMINAL)->count(),
            'total' => FileWorkflow::where('file_id', $file->id)->count(),
            // Waiting on this reader specifically, the one number that means
            // "you have something to do".
            'mineCount' => FileWorkflowStep::query()
                ->whereIn('workflow_id', FileWorkflow::where('file_id', $file->id)->select('id'))
                ->where(function ($q) use ($viewer) {
                    $q->where('user_id', $viewer->id);
                    $memberIds = ContactIdentity::idsFor($viewer);
                    if ($memberIds !== []) {
                        $q->orWhereIn('company_member_id', $memberIds);
                    }
                })
                ->where('status', 'invited')
                ->count(),
        ];
    }

    /** The status badge for a file. §23. Null when nothing has been sent. */
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
        $sender = ContactIdentity::present($workflow->sender, $workflow->senderMember);

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
            'sender' => ($workflow->sender || $workflow->senderMember || $workflow->created_by) ? [
                'name' => $sender['name'],
                'avatar' => $sender['avatar'],
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
            'name' => $step->user?->name ?? $step->companyMember?->displayName() ?? $step->name ?? $step->email,
            'email' => $step->user?->email ?? $step->companyMember?->email ?? $step->email,
            'avatar' => $step->user?->photoUrl(),
            'role' => $step->role,
            'position' => $step->position,
            'status' => $step->status,
            'statusLabel' => self::stepLabel($step->status),
            'comment' => $step->comment,
            'respondedAt' => optional($step->responded_at)->toIso8601String(),
            'delegatedFrom' => $step->delegated_from_id ? true : false,
            'reminderCount' => (int) $step->reminder_count,
        ];
    }

    /**
     * How one person's outcome reads.
     *
     * Public because the cross-file hub shows the same steps away from the
     * file, and two vocabularies for the same column would let the viewer's
     * panel and the Requests page disagree about what happened.
     */
    public static function stepLabel(string $status): string
    {
        return match ($status) {
            'pending' => 'Not yet asked',
            'invited' => 'Waiting',
            'approved' => 'Approved',
            'declined' => 'Declined',
            'changes_requested' => 'Requested changes',
            'acknowledged' => 'Acknowledged',
            'responded' => 'Responded',
            'signed' => 'Signed',
            default => ucfirst(str_replace('_', ' ', $status)),
        };
    }

    /** The workflow's own audit trail, oldest first. §6 "Workflow History". */
    public static function history(FileWorkflow $workflow): array
    {
        return FileWorkflowEvent::where('workflow_id', $workflow->id)
            ->with(['actor', 'companyMember'])
            ->orderBy('id')
            ->get()
            ->map(function (FileWorkflowEvent $e) {
                $actor = ContactIdentity::present($e->actor, $e->companyMember, $e->actor_name);

                return [
                    'action' => $e->action,
                    'detail' => $e->detail,
                    'meta' => $e->meta,
                    'at' => optional($e->created_at)->toIso8601String(),
                    'actor' => ($e->actor || $e->companyMember || $e->actor_name) ? [
                        'name' => $actor['name'],
                        'avatar' => $actor['avatar'],
                    ] : null,
                ];
            })
            ->values()
            ->all();
    }
}
