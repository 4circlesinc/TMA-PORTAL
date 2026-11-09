<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipDocument;
use App\Models\User;
use App\Support\Cip\AdditionalDocuments;
use App\Support\Cip\Appeal;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Contacts;
use App\Support\Cip\DocumentRequests;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Intake;
use App\Support\Cip\Package;
use App\Support\Cip\Status;
use App\Support\Realtime\Live;
use App\Models\FileRequest;
use App\Support\Access\Role;
use App\Support\Files\FileRequests;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Filing one checklist slot from the application page.
 *
 * Intake already does this on create and on an unlocked edit. Post-approval
 * files have usually confirmed the original package, so that form is shut,
 * and the COR (then NIC, then passport) list still has to be answered on the
 * person tab. This is the same {@see DocumentSlots::fill()} door, aimed at
 * one existing slot, so Document Requirements still decide what is asked.
 */
class CipDocumentUploadController extends Controller
{
    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $document = $this->reachable($user, $uuid);

        abort_unless(
            CipAccess::canCreate($user),
            403,
            'You cannot upload documents on this application.',
        );

        $document->loadMissing(['person.application', 'requirement']);
        $person = $document->person;
        $person->setRelation('application', $document->application);

        $photo = $document->type === DocumentTypes::PASSPORT_PHOTO;
        $data = $request->validate([
            'file' => $photo
                ? ['required', 'file', Intake::photoRule()]
                : Intake::documentRule(),
            'documentName' => ['nullable', 'string', 'max:120'],
        ], [
            'file.required' => 'Choose a file to upload.',
            'file.mimes' => 'Upload a PDF or an image.',
            'file.max' => 'That file is too large. Keep it under 10MB.',
        ]);

        try {
            if ($document->file && $document->displayStatus() === DocumentStatus::UPDATE_REQUIRED && ! $photo) {
                // This slot's own file, as its next version. A second FileItem
                // would leave the refused scan as the one the checklist shows.
                DocumentSlots::replace($document, $data['file'], $user);
            } elseif ($photo) {
                // Replacing: this door is only ever reached by someone
                // choosing a file for this slot, never by a draft autosave,
                // so a photo arriving on a filled slot is meant to supersede
                // the one there.
                Intake::filePhoto($person, $data['file'], $user, replace: true);
            } elseif (AdditionalDocuments::is($document->type) && $document->file_id) {
                // The open box is a drawer, not an answer: a second paper
                // joins the first rather than being refused as a duplicate
                // filing. The number is unused — these files keep their own
                // names — but attach() takes one for every other requirement.
                DocumentSlots::attach($person, $document->type, $data['file'], $user, 0);
            } else {
                DocumentSlots::fill($person, $document->type, $data['file'], $user, $data['documentName'] ?? null);
            }
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        $document = $document->fresh(['file', 'application', 'requirement']);
        $application = $document->application;

        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json([
            'document' => [
                'id' => $document->uuid,
                'label' => DocumentTypes::present((string) $document->label),
                'uploaded' => $document->isFilled(),
                'status' => $document->displayStatus(),
                'statusLabel' => DocumentStatus::label($document->displayStatus()),
                'statusTone' => DocumentStatus::tone($document->displayStatus()),
                'fileId' => $document->isFilled() ? $document->file?->uuid : null,
                'fileName' => $document->isFilled() ? $document->file?->name : null,
                'canUpload' => self::canUpload($document, $user),
            ],
            'application' => [
                'id' => $application->uuid,
                'status' => $application->status,
                'statusLabel' => Status::label($application->status),
                'statusTone' => Status::tone($application->status),
                ...Confirmation::payload($application, $user),
                ...Appeal::payload($application, $user),
            ],
        ]);
    }

    /**
     * Ask for several checklist documents in one request.
     *
     * From the application's checklist or the edit screen: tick the papers
     * that are missing, send one request to the service provider (or to
     * anyone, by name and email). Each upload is renamed to the document's
     * filed name and lands in its own slot. Staff only.
     */
    public function requestDocuments(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        /*
         * Staff, and the service provider on its own applications (item 8):
         * a provider asks the applicant, or anyone else, for the papers the
         * file still needs. ApplicationScope keeps them to the files their
         * firm filed, and they always ask "someone else" — the service
         * provider is who they are.
         */
        $provider = $user && ! Role::isStaff($user) && CipAccess::isProviderContact($user);
        abort_unless($user && (Role::isStaff($user) || $provider), 403, 'Only staff and the service provider can request documents.');
        $application = ApplicationScope::findOrFail($user, $uuid);
        if ($provider) {
            $request->merge(['to' => 'someone', 'cc' => []]);
        }

        $data = $request->validate([
            'documents' => ['required', 'array', 'min:1', 'max:60'],
            'documents.*' => ['string', 'max:64'],
            'to' => ['required', 'in:provider,someone'],
            // Someone else: one or more addresses, entered like the status
            // dialog's CC. The service provider: its own contacts, plus any
            // addresses copied in.
            'emails' => ['nullable', 'required_if:to,someone', 'array', 'max:20'],
            'emails.*' => ['email', 'max:191'],
            'cc' => ['nullable', 'array', 'max:20'],
            'cc.*' => ['email', 'max:191'],
            'message' => ['nullable', 'string', 'max:2000'],
            'allowedExtensions' => ['nullable', 'array', 'max:64'],
            'allowedExtensions.*' => ['string', 'max:32'],
            'expiresAt' => ['nullable', 'date', 'after:today'],
            'reminderEveryDays' => ['nullable', 'integer'],
            'send' => ['nullable', 'boolean'],
        ], [
            'documents.required' => 'Choose at least one document to ask for.',
            'emails.required_if' => 'Enter the email address of the person you are asking.',
            'emails.*.email' => 'One of those is not an email address.',
            'cc.*.email' => 'One of the CC addresses is not an email address.',
        ]);

        $slots = CipDocument::query()
            ->where('application_id', $application->id)
            ->whereIn('uuid', $data['documents'])
            ->get();

        if ($slots->count() !== count(array_unique($data['documents']))) {
            throw ValidationException::withMessages(['documents' => 'Some of those documents are not on this application.']);
        }

        // Who it goes to: the service provider's contacts on this file, or
        // the addresses entered. Copied addresses join either list; anyone
        // with a portal login is also told in the portal.
        $byEmail = function (string $email): array {
            return [
                'email' => $email,
                'name' => null,
                'userId' => \App\Models\User::query()
                    ->whereRaw('LOWER(email) = ?', [mb_strtolower($email)])
                    ->value('id'),
            ];
        };
        $recipients = $data['to'] === 'provider'
            ? array_values(array_filter(
                \App\Support\Cip\Contacts::providerSide($application),
                fn (array $r) => ($r['mail'] ?? true) !== false && trim((string) $r['email']) !== '',
            ))
            : array_map($byEmail, $data['emails'] ?? []);

        $seen = array_map(fn (array $r) => mb_strtolower((string) $r['email']), $recipients);
        foreach ($data['cc'] ?? [] as $copy) {
            if (! in_array(mb_strtolower($copy), $seen, true)) {
                $recipients[] = $byEmail($copy);
                $seen[] = mb_strtolower($copy);
            }
        }

        if ($recipients === []) {
            throw ValidationException::withMessages([
                'to' => 'Nobody at the service provider has an email address on this application. Ask someone by name and email instead.',
            ]);
        }

        $application->loadMissing('provider');
        $first = $recipients[0];
        $options = array_filter([
            'message' => trim((string) ($data['message'] ?? '')) ?: null,
            'recipient_name' => $data['to'] === 'provider'
                ? ($application->provider?->name ?: $first['name'])
                : null,
            'recipient_email' => count($recipients) === 1 ? $first['email'] : null,
            'recipient_user_id' => count($recipients) === 1 ? ($first['userId'] ?? null) : null,
            'allowed_extensions' => FileRequests::normalizeExtensions($data['allowedExtensions'] ?? null),
            'expires_at' => $data['expiresAt'] ?? now()->addDays(14)->toDateString(),
            'reminder_every_days' => FileRequests::reminderDaysFor($user, $data['reminderEveryDays'] ?? null),
        ], fn ($value) => $value !== null);

        try {
            $fileRequest = DocumentRequests::forMany($application, $slots, $user, $options);
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        $emailed = 0;
        if ($request->boolean('send', true)) {
            foreach ($recipients as $recipient) {
                $emailed += DocumentRequests::sendTo($fileRequest, $recipient, $user) ? 1 : 0;
            }
        }

        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json([
            'request' => FileRequests::present($fileRequest->fresh(['folder:id,uuid,name', 'client:id,uid,name', 'creator:id,name'])),
            'documents' => $slots->count(),
            'emailed' => $emailed,
            'recipients' => array_map(fn (array $r) => $r['name'] ?: $r['email'], $recipients),
        ], 201);
    }

    public static function canUpload(CipDocument $document, ?User $viewer): bool
    {
        if (! CipAccess::canCreate($viewer)) {
            return false;
        }

        $status = $document->displayStatus();

        /*
         * The open Additional documents box never fills up. Every other slot
         * holds one answer and closes once it has it, so that a filed document
         * is replaced deliberately through the file viewer rather than
         * silently overwritten. This box holds the papers no checklist named,
         * so "already has one" is no reason to refuse the next. It still shuts
         * when the package is locked, like everything else.
         */
        if (AdditionalDocuments::is($document->type)) {
            return ! Package::locksDocument($document);
        }

        if (! in_array($status, [DocumentStatus::PENDING_UPLOAD, DocumentStatus::UPDATE_REQUIRED], true)) {
            return false;
        }

        return ! Package::locksDocument($document);
    }

    private function reachable(User $user, string $uuid): CipDocument
    {
        $document = CipDocument::query()->where('uuid', $uuid)->firstOrFail();

        abort_unless(
            ApplicationScope::query($user)->whereKey($document->application_id)->exists(),
            404,
        );

        return $document;
    }
}
