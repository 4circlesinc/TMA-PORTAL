<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipDocument;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Confirmation;
use App\Support\Cip\Contacts;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Intake;
use App\Support\Cip\Package;
use App\Support\Cip\Status;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        ], [
            'file.required' => 'Choose a file to upload.',
            'file.mimes' => 'Upload a PDF or an image.',
            'file.max' => 'That file is too large. Keep it under 10MB.',
        ]);

        try {
            if ($photo) {
                Intake::filePhoto($person, $data['file'], $user);
            } else {
                DocumentSlots::fill($person, $document->type, $data['file'], $user);
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
            ],
        ]);
    }

    public static function canUpload(CipDocument $document, ?User $viewer): bool
    {
        if (! CipAccess::canCreate($viewer)) {
            return false;
        }

        $status = $document->displayStatus();

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
