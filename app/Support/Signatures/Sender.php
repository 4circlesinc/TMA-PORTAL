<?php

namespace App\Support\Signatures;

use App\Mail\SignatureCompleted;
use App\Mail\SignatureInvitation;
use App\Models\FileItem;
use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Turns a draft into a live signature request: issues one link per actor and
 * emails whoever's turn it is.
 *
 * Sending is the point of no return - once a link is out you can't unsee it -
 * so everything that could make the request nonsense is checked first.
 */
class Sender
{
    /**
     * @return array<string, string> recipient uuid => raw token
     *
     * @throws SendValidationException
     */
    public static function send(SignatureRequest $request, int $actorId, ?int $expiresInDays = null): array
    {
        self::assertSendable($request);

        $expiresAt = now()->addDays($expiresInDays ?? SigningToken::DEFAULT_DAYS);

        $tokens = DB::transaction(function () use ($request, $expiresAt) {
            $issued = [];
            foreach (SigningFlow::actors($request) as $recipient) {
                $issued[$recipient->uuid] = SigningToken::issue($recipient, $expiresAt);
            }

            $request->forceFill([
                'status' => Status::SENT,
                'sent_at' => now(),
                'expires_at' => $expiresAt,
            ])->save();

            return $issued;
        });

        Activity::log($request, Activity::SENT, $actorId, [
            'recipients' => count($tokens),
            'expiresAt' => $expiresAt->toIso8601String(),
        ]);

        // Only the first group is invited; later signers are emailed when
        // their turn arrives, so a link can't sit in an inbox before it works.
        foreach (SigningFlow::currentGroup($request->fresh()) as $recipient) {
            self::invite($request, $recipient, $tokens[$recipient->uuid] ?? null);
            // Recording this is what stops advance() emailing them again: with
            // parallel signers (same order), the group is still "current"
            // after one of them signs.
            $recipient->forceFill(['invited_at' => now()])->save();
        }

        return $tokens;
    }

    /** Email one recipient their link. */
    public static function invite(SignatureRequest $request, SignatureRecipient $recipient, ?string $rawToken = null): void
    {
        $raw = $rawToken ?? SigningToken::reveal($recipient);
        if (! $raw) {
            return;
        }

        Mail::to($recipient->email)->send(new SignatureInvitation($request, $recipient, SigningToken::url($raw)));
    }

    /**
     * Move the flow on after someone signs: either finish, or invite the next
     * group. Returns the request's new status.
     */
    public static function advance(SignatureRequest $request): string
    {
        $request->refresh();
        $status = SigningFlow::deriveStatus($request);

        if ($status === Status::COMPLETED) {
            $request->forceFill(['status' => $status, 'completed_at' => now()])->save();
            Activity::log($request, Activity::COMPLETED, null);

            // Produce the signed copy and file it in the library. Stamping
            // failure is logged and left non-fatal - the signatures are
            // already recorded, and the copy can be regenerated.
            $signed = Completer::finalize($request);
            self::notifyCompleted($request->fresh(), $signed);

            return $status;
        }

        $request->forceFill(['status' => $status])->save();

        foreach (SigningFlow::currentGroup($request) as $recipient) {
            // Only chase people who haven't been told yet.
            if ($recipient->invited_at !== null) {
                continue;
            }
            self::invite($request, $recipient);
            $recipient->forceFill(['invited_at' => now()])->save();
        }

        return $status;
    }

    /**
     * Send everyone the finished document: the signers, any CC, and the
     * sender. This is what the signing page promised them when they finished.
     */
    private static function notifyCompleted(SignatureRequest $request, ?FileItem $signed): void
    {
        $request->loadMissing('recipients', 'creator');

        $sent = [];
        foreach ($request->recipients as $recipient) {
            $email = mb_strtolower($recipient->email);
            if (isset($sent[$email])) {
                continue;
            }
            $sent[$email] = true;

            Mail::to($recipient->email)->send(
                new SignatureCompleted($request, $signed, $recipient->name)
            );
        }

        // The sender too, unless they were already a recipient of it.
        $creator = $request->creator;
        if ($creator && ! isset($sent[mb_strtolower($creator->email)])) {
            Mail::to($creator->email)->send(
                new SignatureCompleted($request, $signed, $creator->name)
            );
        }
    }

    /** @throws SendValidationException */
    public static function assertSendable(SignatureRequest $request): void
    {
        if ($request->status !== Status::DRAFT) {
            throw new SendValidationException('Only a draft can be sent.');
        }
        if (! $request->file) {
            throw new SendValidationException('The document for this request is no longer available.');
        }

        // Fail here rather than after a recipient has already signed something
        // we can't produce a signed copy of.
        if (! Stamper::canStamp($request->file)) {
            throw new SendValidationException(
                'This document can\'t be prepared for signing — it may be password-protected or damaged.'
            );
        }

        $actors = SigningFlow::actors($request);
        if (! $actors) {
            throw new SendValidationException('Add at least one signer or approver before sending.');
        }

        // Approvers review and decide - they place no fields. Only signers need
        // somewhere to sign, so the field rules apply to them alone.
        $signers = array_values(array_filter($actors, fn ($a) => $a->role === 'signer'));
        $fields = $request->fields()->get();

        if ($signers && $fields->isEmpty()) {
            throw new SendValidationException('Place at least one field before sending.');
        }

        // A signer with nothing to do would receive a link to a document they
        // can't act on, and the request could never complete.
        $withFields = $fields->pluck('signature_recipient_id')->filter()->unique();
        foreach ($signers as $actor) {
            if (! $withFields->contains($actor->id)) {
                throw new SendValidationException(
                    sprintf('%s has no fields to complete. Assign a field or remove them.', $actor->name ?: $actor->email)
                );
            }
        }
    }
}
