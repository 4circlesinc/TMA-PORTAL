<?php

namespace App\Support\Files\Workflow;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowEvent;
use App\Models\FileWorkflowStep;
use App\Models\User;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\AccessGrants;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\Versions;
use App\Support\Notifications\Notifier;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * The file review/approval flow.
 *
 * Three rules shape everything here:
 *
 *  - **A workflow reviews one specific version.** It is bound to a
 *    `file_version_id` at send time and never moves. If a newer version is
 *    uploaded while it is open, the workflow is marked as superseded and its
 *    sender is told, but its record still says exactly what was reviewed. A
 *    workflow that silently followed the file would make every approval
 *    meaningless.
 *  - **A decline or a changes-request halts the whole flow.** Continuing to ask
 *    the remaining approvers after somebody has said no wastes their time and
 *    produces a contradictory record.
 *  - **Nothing here writes bytes.** Locking refuses new versions; it never
 *    modifies or removes content.
 */
class Engine
{
    /**
     * Create and send a workflow.
     *
     * @param  list<array{user_id?:int, email?:string, name?:string, position?:int}>  $recipients
     */
    public static function send(
        FileItem $file,
        User $sender,
        string $type,
        array $recipients,
        array $options = [],
    ): FileWorkflow {
        abort_unless(in_array($type, Status::TYPES, true), 422, 'Unknown workflow type.');
        abort_if($recipients === [], 422, 'Choose at least one person.');

        // The version being reviewed is pinned now, so later uploads cannot
        // change what these people were asked to look at.
        Versions::recordInitial($file);
        $version = Versions::current($file);

        $workflow = DB::transaction(function () use ($file, $sender, $type, $recipients, $options, $version) {
            $companyId = ContactIdentity::companyIdForFile($file);
            $senderStamp = ContactIdentity::stamp($sender, $companyId);

            $workflow = FileWorkflow::create([
                'uuid' => (string) Str::uuid(),
                'file_id' => $file->id,
                'file_version_id' => $version?->id,
                'type' => $type,
                'status' => Status::openStatusFor($type),
                'created_by' => $sender->id,
                'created_by_member_id' => $senderStamp['company_member_id'],
                'message' => $options['message'] ?? null,
                'due_at' => $options['due_at'] ?? null,
                'require_all' => $options['require_all'] ?? true,
                'ordered' => $options['ordered'] ?? false,
                'require_comment' => $options['require_comment'] ?? false,
                'lock_file' => $options['lock_file'] ?? false,
                'reminder_days' => $options['reminder_days'] ?? null,
            ]);

            $role = Status::roleFor($type);

            foreach (array_values($recipients) as $i => $r) {
                $recipientUserId = $r['user_id'] ?? null;
                $recipientMember = ContactIdentity::forUserId($recipientUserId, $companyId);

                FileWorkflowStep::create([
                    'uuid' => (string) Str::uuid(),
                    'workflow_id' => $workflow->id,
                    'user_id' => $recipientUserId,
                    'company_member_id' => $recipientMember?->id,
                    'email' => $r['email'] ?? $recipientMember?->displayEmail(),
                    'name' => $r['name'] ?? $recipientMember?->displayName(),
                    'role' => $role,
                    // Parallel flows put everyone at position 1 so they are all
                    // invited at once; ordered flows step through 1, 2, 3…
                    'position' => ($options['ordered'] ?? false) ? ($r['position'] ?? $i + 1) : 1,
                    'status' => 'pending',
                ]);
            }

            return $workflow;
        });

        self::log($workflow, $sender, 'sent', null, [
            'type' => $type,
            'recipients' => count($recipients),
            'version' => $version?->version_number,
        ]);

        Activity::forFile($sender->id, $file, 'approval-sent', [
            'type' => $type,
            'workflow' => $workflow->uuid,
            'version' => $version?->version_number,
        ]);

        self::inviteNextGroup($workflow->fresh());
        self::signal($workflow->fresh());

        return $workflow->fresh();
    }

    /**
     * Invite everyone at the lowest position that still has open steps.
     *
     * `invited_at` must be stamped here rather than at send time, or a parallel
     * group gets invited twice when the flow later advances, the same trap the
     * signature engine hit.
     */
    public static function inviteNextGroup(FileWorkflow $workflow): void
    {
        $next = $workflow->steps()
            ->whereIn('status', ['pending'])
            ->whereNull('invited_at')
            ->orderBy('position')
            ->first();

        if (! $next) {
            return;
        }

        $group = $workflow->steps()
            ->where('position', $next->position)
            ->where('status', 'pending')
            ->whereNull('invited_at')
            ->get();

        foreach ($group as $step) {
            $step->update(['status' => 'invited', 'invited_at' => now()]);
            self::notifyStep($workflow, $step);
        }
    }

    /**
     * Record one participant's response.
     *
     * @param  string  $action  approve|decline|request_changes|acknowledge|submit_feedback
     */
    public static function respond(FileWorkflowStep $step, User $actor, string $action, ?string $comment = null): FileWorkflow
    {
        $workflow = $step->workflow;

        abort_if(Status::isTerminal($workflow->status), 422, 'This request is already closed.');
        abort_unless($step->isOpen(), 422, 'You have already responded.');
        abort_unless(in_array($action, Status::actionsFor($workflow->type), true), 422, 'That action does not apply here.');

        // "Comments required" has to be enforced here, not just hinted at in
        // the dialog, otherwise it is decoration.
        if ($workflow->require_comment && trim((string) $comment) === '') {
            abort(422, 'A comment is required for this request.');
        }
        // A refusal always needs a reason, whatever the setting says.
        if (in_array($action, ['decline', 'request_changes'], true) && trim((string) $comment) === '') {
            abort(422, 'Please say why.');
        }

        $stepStatus = match ($action) {
            'approve' => 'approved',
            'decline' => 'declined',
            'request_changes' => 'changes_requested',
            'acknowledge' => 'acknowledged',
            default => 'responded',
        };

        $step->update([
            'status' => $stepStatus,
            'responded_at' => now(),
            'comment' => $comment,
        ]);

        self::log($workflow, $actor, $action, $comment, ['step' => $step->uuid]);
        Activity::forFile($actor->id, $workflow->file, match ($action) {
            'approve' => 'approved',
            'decline' => 'declined',
            'request_changes' => 'changes-requested',
            default => 'approval-sent',
        }, ['workflow' => $workflow->uuid, 'comment' => $comment]);

        $advanced = self::advance($workflow->fresh(), $actor, $action);
        self::signal($advanced);

        return $advanced;
    }

    /**
     * Decide what the workflow becomes after a response.
     */
    private static function advance(FileWorkflow $workflow, User $actor, string $action): FileWorkflow
    {
        // A refusal is terminal: everyone else is spared, and the record is
        // unambiguous about why it stopped.
        if ($action === 'decline') {
            return self::close($workflow, Status::DECLINED, $actor);
        }
        if ($action === 'request_changes') {
            return self::close($workflow, Status::CHANGES_REQUESTED, $actor);
        }

        $open = $workflow->steps()->whereIn('status', ['pending', 'invited'])->count();

        // "Any one of them", the first favourable response settles it.
        if (! $workflow->require_all) {
            return self::close($workflow, Status::successStatusFor($workflow->type), $actor);
        }

        if ($open === 0) {
            return self::close($workflow, Status::successStatusFor($workflow->type), $actor);
        }

        // More to go: in an ordered flow, that means inviting the next person.
        if ($workflow->ordered) {
            self::inviteNextGroup($workflow);
        }

        return $workflow->fresh();
    }

    public static function cancel(FileWorkflow $workflow, User $actor): FileWorkflow
    {
        abort_if(Status::isTerminal($workflow->status), 422, 'This request is already closed.');

        $closed = self::close($workflow, Status::CANCELLED, $actor);
        self::signal($closed);

        return $closed;
    }

    /**
     * Hand a step to somebody else.
     *
     * The original person stays on the record as having delegated it, so the
     * trail never loses who was asked first.
     */
    public static function delegate(FileWorkflowStep $step, User $actor, User $to): FileWorkflowStep
    {
        $workflow = $step->workflow;

        abort_if(Status::isTerminal($workflow->status), 422, 'This request is already closed.');
        abort_unless($step->isOpen(), 422, 'That step has already been answered.');
        abort_if($to->id === $step->user_id, 422, 'That is already the assignee.');
        // Handing your step to somebody outside the file is allowed when you
        // could have shared it with them, the access follows the handover.
        abort_if(AccessGrants::ensure($actor, $to, $workflow->file, 'delegation') === null, 422,
            'That person cannot open this file, and you can’t share it with them.');

        $step->update([
            'delegated_from_id' => $step->user_id,
            'delegated_to_id' => $to->id,
            'user_id' => $to->id,
            'email' => $to->email,
            'name' => $to->name,
            'status' => 'invited',
            'invited_at' => now(),
        ]);

        self::log($workflow, $actor, 'delegated', null, ['to' => $to->name, 'step' => $step->uuid]);
        self::notifyStep($workflow, $step->fresh());
        // After the update, so the person handed the step is in the reach and
        // sees it arrive; the one who handed it over sees it leave.
        self::signal($workflow->fresh());

        return $step->fresh();
    }

    private static function close(FileWorkflow $workflow, string $status, ?User $actor): FileWorkflow
    {
        $workflow->update([
            'status' => $status,
            'completed_at' => now(),
            'cancelled_at' => $status === Status::CANCELLED ? now() : null,
        ]);

        // Stamp the outcome onto the exact version that was reviewed, so a
        // badge on an old version keeps telling the truth for ever.
        if ($workflow->file_version_id) {
            FileVersion::where('id', $workflow->file_version_id)->update(['approval_status' => $status]);
        }

        self::log($workflow, $actor, 'closed', Status::label($status), ['status' => $status]);
        self::notifySender($workflow->fresh(), $status);

        return $workflow->fresh();
    }

    /**
     * Called when a new version lands on a file with an open workflow.
     *
     * The workflow is NEVER moved onto the new version silently. Either the
     * file was locked (in which case the upload never got here) or the workflow
     * is marked superseded and its sender is told, so they can decide whether
     * to restart it.
     */
    public static function noteNewVersion(FileItem $file, FileVersion $version): void
    {
        $open = FileWorkflow::where('file_id', $file->id)
            ->whereNotIn('status', Status::TERMINAL)
            ->get();

        foreach ($open as $workflow) {
            $workflow->update(['superseded_by_version_id' => $version->id]);
            self::log($workflow, null, 'superseded', 'A newer version was uploaded while this was open.', [
                'version' => $version->version_number,
            ]);

            Notifier::send([
                'user' => $workflow->created_by,
                'type' => 'file.workflow_superseded',
                'title' => 'A new version was uploaded during your '.$workflow->type.' request',
                'message' => $file->name.' is now at version '.$version->version_number.
                    ', but the request is still on version '.($workflow->version?->version_number ?? '-').'.',
                'subject' => $file,
                'action_url' => '/folders/all?file='.$file->uuid,
            ]);

            // The row now says which version overtook it, so the lists showing
            // it are out of date.
            self::signal($workflow);
        }
    }

    /** True when an open workflow forbids replacing the file's content. */
    public static function isLocked(FileItem $file): ?FileWorkflow
    {
        return FileWorkflow::where('file_id', $file->id)
            ->where('lock_file', true)
            ->whereNotIn('status', Status::TERMINAL)
            ->first();
    }

    /** The workflow whose status the file's badge should show. */
    public static function activeFor(FileItem $file): ?FileWorkflow
    {
        return FileWorkflow::where('file_id', $file->id)
            ->whereNotIn('status', Status::TERMINAL)
            ->latest('id')
            ->first()
            ?? FileWorkflow::where('file_id', $file->id)->latest('id')->first();
    }

    /* ── who may do what ─────────────────────────────────────────── */

    /** Sending a file for review is an editor-and-above action. */
    public static function canSend(User $user, FileItem $file): bool
    {
        return FileAccess::can($user, 'upload', $file);
    }

    /** Only the sender (or an admin) may cancel or reassign. */
    public static function canManage(User $user, FileWorkflow $workflow): bool
    {
        return $workflow->created_by === $user->id || FileAccess::isAdmin($user);
    }

    /**
     * The step this user has actually been ASKED to answer.
     *
     * `invited` only, never `pending`. In an ordered flow a later approver's
     * step exists from the start but has not been reached yet; treating it as
     * actionable let somebody at position 3 approve before position 1 was even
     * notified, which defeats the whole point of ordering.
     */
    public static function stepFor(FileWorkflow $workflow, User $user): ?FileWorkflowStep
    {
        $memberIds = ContactIdentity::idsFor($user);

        return $workflow->steps()
            ->where('status', 'invited')
            ->where(function ($q) use ($user, $memberIds) {
                $q->where('user_id', $user->id);
                if ($memberIds !== []) {
                    $q->orWhereIn('company_member_id', $memberIds);
                }
            })
            ->first();
    }

    /* ── plumbing ────────────────────────────────────────────────── */

    /**
     * Tell the lists this request moved — the Workflows section, and the home
     * board's Requests tile.
     *
     * Reach is exactly the people on the record: whoever sent it and whoever
     * was asked, including anyone a step was handed to. No staff room, because
     * a request is somebody's specific business, not the firm's news; and no
     * rows in the payload, so each of them refetches through the endpoint that
     * already decides what they may see.
     */
    private static function signal(FileWorkflow $workflow): void
    {
        $workflow->loadMissing('steps');

        Live::users(Live::WORKFLOWS, $workflow->steps
            ->pluck('user_id')
            ->push($workflow->created_by)
            ->filter()
            ->unique()
            ->all());
    }

    public static function log(FileWorkflow $workflow, ?User $actor, string $action, ?string $detail = null, array $meta = []): void
    {
        $stamp = ContactIdentity::stamp($actor, ContactIdentity::companyIdForFile($workflow->file));

        FileWorkflowEvent::create([
            'workflow_id' => $workflow->id,
            'step_id' => null,
            'actor_id' => $actor?->id,
            'company_member_id' => $stamp['company_member_id'],
            'actor_name' => $stamp['actor_name'],
            'action' => $action,
            'detail' => $detail,
            'meta' => $meta ?: null,
            'created_at' => now(),
        ]);
    }

    public static function notifyStep(FileWorkflow $workflow, FileWorkflowStep $step): void
    {
        if (! $step->user_id) {
            return;
        }

        try {
            Notifier::send([
                'user' => $step->user_id,
                'actor' => $workflow->sender,
                'type' => 'file.approval_requested',
                'title' => ($workflow->sender?->name ?? 'Someone').' asked you to '.
                    self::verbFor($workflow->type).' '.$workflow->file->name,
                'message' => $workflow->message,
                'subject' => $workflow->file,
                'action_url' => '/folders/all?file='.$workflow->file->uuid,
            ]);
        } catch (\Throwable $e) {
            Log::error('Workflow.notifyStep failed', ['workflow' => $workflow->uuid, 'error' => $e->getMessage()]);
        }
    }

    private static function notifySender(FileWorkflow $workflow, string $status): void
    {
        if (! $workflow->created_by) {
            return;
        }

        try {
            Notifier::send([
                'user' => $workflow->created_by,
                'type' => 'file.approval_decision',
                'title' => $workflow->file->name.': '.Status::label($status),
                'subject' => $workflow->file,
                'action_url' => '/folders/all?file='.$workflow->file->uuid,
            ]);
        } catch (\Throwable $e) {
            Log::error('Workflow.notifySender failed', ['workflow' => $workflow->uuid, 'error' => $e->getMessage()]);
        }
    }

    private static function verbFor(string $type): string
    {
        return match ($type) {
            Status::TYPE_APPROVAL => 'approve',
            Status::TYPE_FEEDBACK => 'give feedback on',
            Status::TYPE_ACKNOWLEDGEMENT => 'acknowledge',
            Status::TYPE_SIGNATURE => 'sign',
            default => 'review',
        };
    }
}
