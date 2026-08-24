<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\User;
use App\Support\Files\AccessGrants;
use App\Support\Files\FileAccess;
use App\Support\Files\Workflow\Engine;
use App\Support\Files\Workflow\Status;
use App\Support\Files\Workflow\WorkflowPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Sending a file for feedback, review, approval or acknowledgement, and
 * responding to those requests.
 *
 * Signature requests are accepted as a type but delegated to the signing engine
 * rather than reimplemented here.
 */
class FileWorkflowController extends BaseFilesController
{
    public function index(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);

        return response()->json(WorkflowPresenter::forFile($file, $user));
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);

        abort_unless(Engine::canSend($user, $file), 403, 'You can’t send this file for review.');

        $data = $request->validate([
            'type' => ['required', 'in:'.implode(',', Status::TYPES)],
            'recipients' => ['required', 'array', 'min:1', 'max:50'],
            'recipients.*.userId' => ['required', 'integer', 'min:1'],
            'recipients.*.position' => ['nullable', 'integer', 'min:1', 'max:50'],
            'message' => ['nullable', 'string', 'max:2000'],
            'dueAt' => ['nullable', 'date'],
            'requireAll' => ['nullable', 'boolean'],
            'ordered' => ['nullable', 'boolean'],
            'requireComment' => ['nullable', 'boolean'],
            'lockFile' => ['nullable', 'boolean'],
            'reminderDays' => ['nullable', 'integer', 'min:1', 'max:60'],
        ]);

        // Signature is a different engine; Phase 5 wires the handoff.
        abort_if($data['type'] === Status::TYPE_SIGNATURE, 422,
            'Send for signature from the signature tools.');

        $recipients = [];
        foreach ($data['recipients'] as $r) {
            $person = User::where('id', $r['userId'])->where('status', User::STATUS_APPROVED)->first();
            abort_unless($person, 422, 'One of the people chosen is not an active account.');

            /*
             * Anyone can be asked, whether or not the file has reached them.
             *
             * This used to refuse with "share it with them first", which sent
             * the sender off to the Access panel mid-thought to arrange
             * something they had just asked for in plainer words. Somebody who
             * may share the file may add anyone to it and access follows the
             * request, the person opens it and answers, and the grant is
             * recorded in Access and in the file's activity like any other.
             *
             * The refusal remains for a sender who cannot share: they would be
             * sending a request nobody could act on.
             */
            abort_if(AccessGrants::ensure($user, $person, $file, 'review') === null, 422,
                $person->name.' can’t open this file, and you can’t share it with them.');

            $recipients[] = [
                'user_id' => $person->id,
                'email' => $person->email,
                'name' => $person->name,
                'position' => $r['position'] ?? null,
            ];
        }

        $workflow = Engine::send($file, $user, $data['type'], $recipients, [
            'message' => $data['message'] ?? null,
            'due_at' => $data['dueAt'] ?? null,
            'require_all' => $data['requireAll'] ?? true,
            'ordered' => $data['ordered'] ?? false,
            'require_comment' => $data['requireComment'] ?? false,
            'lock_file' => $data['lockFile'] ?? false,
            'reminder_days' => $data['reminderDays'] ?? null,
        ]);

        return response()->json(WorkflowPresenter::workflow($workflow->fresh()->load('steps.user', 'sender', 'version'), $user), 201);
    }

    /** Approve / decline / request changes / acknowledge / give feedback. */
    public function respond(Request $request, string $uuid, string $workflowUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $workflow = $this->findWorkflow($file, $workflowUuid);

        $data = $request->validate([
            'action' => ['required', 'string', 'max:32'],
            'comment' => ['nullable', 'string', 'max:4000'],
        ]);

        $step = Engine::stepFor($workflow, $user);
        abort_unless($step, 403, 'This request isn’t waiting on you.');

        $updated = Engine::respond($step, $user, $data['action'], $data['comment'] ?? null);

        return response()->json(WorkflowPresenter::workflow($updated->load('steps.user', 'sender', 'version'), $user));
    }

    public function cancel(Request $request, string $uuid, string $workflowUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $workflow = $this->findWorkflow($file, $workflowUuid);

        abort_unless(Engine::canManage($user, $workflow), 403, 'Only the sender can cancel this request.');

        $updated = Engine::cancel($workflow, $user);

        return response()->json(WorkflowPresenter::workflow($updated->load('steps.user', 'sender', 'version'), $user));
    }

    /** Hand your own step to somebody else, or reassign as the sender. */
    public function delegate(Request $request, string $uuid, string $workflowUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid);
        $workflow = $this->findWorkflow($file, $workflowUuid);

        $data = $request->validate([
            'step' => ['required', 'string', 'max:64'],
            'userId' => ['required', 'integer', 'min:1'],
        ]);

        $step = FileWorkflowStep::where('workflow_id', $workflow->id)->where('uuid', $data['step'])->first();
        abort_unless($step, 404, 'That step no longer exists.');

        // Either it is your step to hand on, or you are the sender reassigning.
        abort_unless($step->user_id === $user->id || Engine::canManage($user, $workflow), 403,
            'You can’t reassign that step.');

        $to = User::where('id', $data['userId'])->where('status', User::STATUS_APPROVED)->first();
        abort_unless($to, 422, 'That person is not an active account.');

        Engine::delegate($step, $user, $to);

        return response()->json(WorkflowPresenter::workflow($workflow->fresh()->load('steps.user', 'sender', 'version'), $user));
    }

    /** The workflow's own audit trail. */
    public function history(Request $request, string $uuid, string $workflowUuid): JsonResponse
    {
        $user = $this->user($request);
        $file = $this->findFile($uuid, withTrashed: true);
        FileAccess::authorize($user, 'view', $file);
        $workflow = $this->findWorkflow($file, $workflowUuid);

        return response()->json(['events' => WorkflowPresenter::history($workflow)]);
    }

    private function findWorkflow(FileItem $file, string $workflowUuid): FileWorkflow
    {
        $workflow = FileWorkflow::where('file_id', $file->id)->where('uuid', $workflowUuid)->first();

        abort_unless($workflow, 404, 'That request no longer exists.');

        return $workflow;
    }
}
