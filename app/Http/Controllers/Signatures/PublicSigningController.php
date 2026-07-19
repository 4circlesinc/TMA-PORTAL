<?php

namespace App\Http\Controllers\Signatures;

use App\Http\Controllers\Controller;
use App\Mail\SignatureChangesRequested;
use App\Mail\SignatureDeclined;
use App\Models\SignatureField;
use App\Models\SignatureRecipient;
use App\Support\Files\Vault;
use App\Support\Signatures\Activity;
use App\Support\Signatures\FieldType;
use App\Support\Signatures\FieldValue;
use App\Support\Signatures\Sender;
use App\Support\Signatures\SendValidationException;
use App\Support\Signatures\SigningFlow;
use App\Support\Signatures\SigningToken;
use App\Support\Signatures\Status;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The recipient's signing page. No login, no portal.
 *
 * The token is the only credential, so every action re-derives everything from
 * it: which request, which recipient, whether it's their turn, and which
 * fields are theirs. A recipient can never see another recipient's fields, the
 * File Library, or any other document - there is no route from here into the
 * portal at all.
 */
class PublicSigningController extends Controller
{
    /** Open the document to sign. */
    public function show(Request $request, string $token)
    {
        $recipient = $this->resolve($token);
        if (! $recipient instanceof SignatureRecipient) {
            return $recipient; // an "unavailable" page
        }

        $signatureRequest = $recipient->request;

        // Signing and declining both revoke the token, so a recipient who has
        // already acted can't reach this page at all - resolve() 404s them
        // first, and the page they saw at the time told them they were done.

        // Holding a link isn't a turn: earlier signers go first.
        if (! SigningFlow::isTurn($recipient)) {
            return response()->view('sign.waiting', [
                'title' => $signatureRequest->title,
                'name' => $recipient->name,
            ]);
        }

        $this->markViewed($recipient);

        // Approvers review and decide - they place no signature, so they get a
        // lean review page (Approve / Request changes) instead of the editor.
        if ($recipient->role === 'approver') {
            return response()->view('sign.approve', [
                'token' => $token,
                'title' => $signatureRequest->title,
                'recipient' => $recipient,
                'sender' => $signatureRequest->creator?->name,
                'message' => $signatureRequest->message,
                'isImage' => in_array(strtolower((string) $signatureRequest->file?->extension), ['png', 'jpg', 'jpeg'], true),
            ]);
        }

        return response()->view('sign.document', [
            'token' => $token,
            'title' => $signatureRequest->title,
            'recipient' => $recipient,
            'sender' => $signatureRequest->creator?->name,
            'message' => $signatureRequest->message,
            'isImage' => in_array(strtolower((string) $signatureRequest->file?->extension), ['png', 'jpg', 'jpeg'], true),
            'fields' => $this->fieldPayload($recipient),
        ]);
    }

    /** The document bytes. Same token rules as the page. */
    public function document(Request $request, string $token): StreamedResponse
    {
        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);
        abort_unless(SigningFlow::isTurn($recipient), 403);

        $file = $recipient->request->file;
        abort_unless($file, 404, 'This document is no longer available.');

        return Vault::preview($file);
    }

    /** Save partly-filled fields so a signer can come back to them. */
    public function progress(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'values' => ['present', 'array'],
        ]);

        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);
        abort_unless(SigningFlow::isTurn($recipient), 403, 'This document is not ready for you yet.');

        try {
            $this->applyValues($recipient, $data['values'], false);
        } catch (SendValidationException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['saved' => true]);
    }

    /** Finish signing. */
    public function submit(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'values' => ['present', 'array'],
        ]);

        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);

        // A double submit (second tab, back button, impatient click) must not
        // sign twice or re-advance the flow.
        if ($recipient->status === 'signed') {
            return response()->json(['done' => true, 'alreadySigned' => true]);
        }
        abort_unless(SigningFlow::isTurn($recipient), 403, 'This document is not ready for you yet.');

        try {
            $this->applyValues($recipient, $data['values'], true);
        } catch (SendValidationException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        DB::transaction(function () use ($recipient, $request) {
            $recipient->forceFill([
                'status' => 'signed',
                'signed_at' => now(),
                'last_ip' => $request->ip(),
            ])->save();

            // The link has done its job; leaving it live is an unnecessary
            // window for anyone who later gets hold of the email.
            SigningToken::revoke($recipient);
        });

        Activity::forRecipient($recipient, Activity::SIGNED);

        // advance() owns everything that happens on completion - stamping the
        // signed copy and mailing it to everyone. Notifying from here too
        // would send the sender a second, duplicate message.
        $status = Sender::advance($recipient->request);

        return response()->json(['done' => true, 'status' => $status]);
    }

    /** Refuse to sign. Ends the request for everyone. */
    public function decline(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:191'],
        ]);

        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);
        abort_unless(SigningFlow::isTurn($recipient), 403, 'This document is not ready for you yet.');

        $signatureRequest = $recipient->request;

        DB::transaction(function () use ($recipient, $signatureRequest, $data, $request) {
            $recipient->forceFill([
                'status' => 'declined',
                'declined_at' => now(),
                'decline_reason' => $data['reason'] ?? null,
                'last_ip' => $request->ip(),
            ])->save();
            SigningToken::revoke($recipient);

            $signatureRequest->forceFill([
                'status' => Status::DECLINED,
                'declined_at' => now(),
            ])->save();

            // One refusal ends it: nobody else should keep signing a document
            // that isn't going to complete.
            $signatureRequest->recipients()
                ->where('id', '!=', $recipient->id)
                ->get()
                ->each(fn (SignatureRecipient $r) => SigningToken::revoke($r));
        });

        Activity::forRecipient($recipient, Activity::DECLINED, array_filter([
            'reason' => $data['reason'] ?? null,
        ]));

        $this->notifyDeclined($recipient, $data['reason'] ?? null);

        return response()->json(['done' => true, 'status' => Status::DECLINED]);
    }

    /** An approver approves the document, moving the flow on like a signature. */
    public function approve(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);
        abort_unless($recipient->role === 'approver', 403, 'This link is not an approval link.');

        if ($recipient->status === 'signed') {
            return response()->json(['done' => true, 'alreadyDone' => true]);
        }
        abort_unless(SigningFlow::isTurn($recipient), 403, 'This document is not ready for you yet.');

        DB::transaction(function () use ($recipient, $data, $request) {
            $recipient->forceFill([
                'status' => 'signed',
                'signed_at' => now(),
                'comment' => $data['comment'] ?? null,
                'last_ip' => $request->ip(),
            ])->save();
            SigningToken::revoke($recipient);
        });

        Activity::forRecipient($recipient, Activity::APPROVED, array_filter([
            'comment' => $data['comment'] ?? null,
        ]));

        // advance() completes + stamps + mails once everyone has acted.
        $status = Sender::advance($recipient->request);

        return response()->json(['done' => true, 'status' => $status]);
    }

    /** An approver asks for changes: the request halts and the sender is told. */
    public function requestChanges(Request $request, string $token): JsonResponse
    {
        $data = $request->validate([
            'comment' => ['required', 'string', 'max:2000'],
        ]);

        $recipient = $this->resolve($token);
        abort_unless($recipient instanceof SignatureRecipient, 404);
        abort_unless($recipient->role === 'approver', 403, 'This link is not an approval link.');
        abort_unless(SigningFlow::isTurn($recipient), 403, 'This document is not ready for you yet.');

        $signatureRequest = $recipient->request;

        DB::transaction(function () use ($recipient, $signatureRequest, $data, $request) {
            $recipient->forceFill([
                'status' => 'changes_requested',
                'declined_at' => now(),
                'comment' => $data['comment'],
                'last_ip' => $request->ip(),
            ])->save();
            SigningToken::revoke($recipient);

            $signatureRequest->forceFill([
                'status' => Status::CHANGES_REQUESTED,
                'declined_at' => now(),
            ])->save();

            // The request is on hold until the sender revises it: no one else
            // should keep acting on a document that's going to change.
            $signatureRequest->recipients()
                ->where('id', '!=', $recipient->id)
                ->get()
                ->each(fn (SignatureRecipient $r) => SigningToken::revoke($r));
        });

        Activity::forRecipient($recipient, Activity::CHANGES_REQUESTED, ['comment' => $data['comment']]);

        $this->notifyChangesRequested($recipient, $data['comment']);

        return response()->json(['done' => true, 'status' => Status::CHANGES_REQUESTED]);
    }

    /* ── internals ─────────────────────────────────── */

    /**
     * Resolve a token to a recipient, or return the page explaining why not.
     * Expiry is judged here rather than by a sweep, so a link stops working the
     * moment it should even if nothing has run.
     */
    private function resolve(string $token): SignatureRecipient|Response
    {
        $recipient = SigningToken::resolve($token);

        if (! $recipient) {
            return response()->view('sign.unavailable', [
                'heading' => 'This signing link isn\'t valid',
                'detail' => 'It may have been used, replaced, or cancelled. Ask the sender for a new one.',
            ], 404);
        }

        $signatureRequest = $recipient->request;

        if (! $signatureRequest || $signatureRequest->trashed()) {
            return response()->view('sign.unavailable', [
                'heading' => 'This document is no longer available',
                'detail' => 'The request was removed by the sender.',
            ], 404);
        }

        if ($recipient->token_expires_at && $recipient->token_expires_at->isPast()) {
            $this->expire($signatureRequest);

            return response()->view('sign.unavailable', [
                'heading' => 'This signing link has expired',
                'detail' => 'Ask the sender to send it again.',
            ], 410);
        }

        if (in_array($signatureRequest->status, [Status::CANCELLED, Status::DECLINED, Status::EXPIRED], true)) {
            return response()->view('sign.unavailable', [
                'heading' => 'This document is no longer open for signing',
                'detail' => 'The request was '.$signatureRequest->status.'.',
            ], 410);
        }

        return $recipient;
    }

    private function expire($signatureRequest): void
    {
        if ($signatureRequest->isFinal()) {
            return;
        }
        $signatureRequest->forceFill(['status' => Status::EXPIRED])->save();
        Activity::log($signatureRequest, Activity::EXPIRED, null);
    }

    private function markViewed(SignatureRecipient $recipient): void
    {
        if ($recipient->viewed_at) {
            return; // first look only; re-opening isn't news
        }

        $recipient->forceFill([
            'status' => $recipient->status === 'pending' ? 'viewed' : $recipient->status,
            'viewed_at' => now(),
            'last_ip' => request()->ip(),
        ])->save();

        Activity::forRecipient($recipient, Activity::VIEWED);

        $signatureRequest = $recipient->request;
        if ($signatureRequest->status === Status::SENT) {
            $signatureRequest->forceFill(['status' => Status::VIEWED])->save();
        }
    }

    /** Only this recipient's fields, never anyone else's. */
    private function fields(SignatureRecipient $recipient)
    {
        return SignatureField::query()
            ->where('signature_request_id', $recipient->signature_request_id)
            ->where('signature_recipient_id', $recipient->id)
            ->orderBy('page')
            ->get();
    }

    private function fieldPayload(SignatureRecipient $recipient): array
    {
        return $this->fields($recipient)->map(fn (SignatureField $f) => [
            'id' => $f->uuid,
            'type' => $f->type,
            'label' => FieldType::label($f->type),
            'page' => (int) $f->page,
            'x' => (float) $f->x,
            'y' => (float) $f->y,
            'width' => (float) $f->width,
            'height' => (float) $f->height,
            'required' => (bool) $f->required,
            'autofilled' => FieldType::isAutofilled($f->type),
            'value' => $f->value,
        ])->all();
    }

    /**
     * Write submitted values onto this recipient's fields.
     *
     * Keyed by field uuid and filtered to fields that are both on this request
     * AND assigned to this recipient, so a crafted payload can't fill in
     * someone else's field or a field from another document.
     *
     * @throws SendValidationException
     */
    private function applyValues(SignatureRecipient $recipient, array $values, bool $finalizing): void
    {
        foreach ($this->fields($recipient) as $field) {
            $isAutofilled = FieldType::isAutofilled($field->type);

            // Mid-signing, leave untouched fields alone; autofilled ones are
            // computed rather than sent, so they're always resolved.
            if (! $finalizing && ! $isAutofilled && ! array_key_exists($field->uuid, $values)) {
                continue;
            }

            $value = FieldValue::normalize($field, $values[$field->uuid] ?? null, $recipient);

            if ($finalizing && $field->required && ($value === null || $value === '')) {
                throw new SendValidationException('Please complete every required field.');
            }

            $wasEmpty = $field->value === null;

            $field->forceFill([
                'value' => $value,
                'completed_at' => $value === null ? null : now(),
            ])->save();

            // Log the transition, not every keystroke-triggered autosave.
            if ($value !== null && $wasEmpty) {
                Activity::forRecipient($recipient, Activity::FIELD_COMPLETED, [
                    'field' => $field->type,
                    'page' => (int) $field->page,
                ]);
            }
        }
    }

    /** Completion is handled by Sender::advance, which mails the document. */
    private function notifyDeclined(SignatureRecipient $recipient, ?string $reason = null): void
    {
        $signatureRequest = $recipient->request;
        $to = $signatureRequest->creator?->email;
        if (! $to) {
            return;
        }

        Mail::to($to)->send(new SignatureDeclined(
            $signatureRequest,
            $reason,
            $recipient->name ?: $recipient->email,
        ));
    }

    private function notifyChangesRequested(SignatureRecipient $recipient, string $comment): void
    {
        $signatureRequest = $recipient->request;
        $to = $signatureRequest->creator?->email;
        if (! $to) {
            return;
        }

        Mail::to($to)->send(new SignatureChangesRequested(
            $signatureRequest,
            $comment,
            $recipient->name ?: $recipient->email,
        ));
    }
}
