<?php

namespace App\Http\Controllers\Signatures;

use App\Http\Controllers\Controller;
use App\Models\SignatureRequest;
use App\Support\Files\FileAccess;
use App\Support\Files\Vault;
use App\Support\Signatures\FieldType;
use App\Support\Signatures\Presenter;
use App\Support\Signatures\Signable;
use App\Support\Signatures\Status;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The document and its placed fields, for the signature editor.
 *
 * Coordinates are page-relative fractions (0..1) throughout - the editor
 * renders at whatever scale fits the viewport and the stamper renders at the
 * PDF's own size, so pixels from one are meaningless to the other.
 */
class SignatureFieldController extends Controller
{
    /**
     * Stream the document being signed.
     *
     * Scoped to the request rather than reusing the File Library's preview
     * route, so Phase 4's public signing link can authorize by token against
     * this same shape without ever granting library access.
     */
    public function document(Request $request, string $uuid): StreamedResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);
        $file = $signatureRequest->file;

        abort_unless($file, 404, 'The document for this request is no longer available.');
        abort_unless(Signable::isSignable($file), 415, Signable::rejectionReason($file));

        return Vault::preview($file);
    }

    /** The placed fields for a request. */
    public function index(Request $request, string $uuid): JsonResponse
    {
        $signatureRequest = $this->findOwned($request, $uuid);
        $presenter = new Presenter($request->user());

        return response()->json([
            'fields' => $presenter->fields($signatureRequest),
            'types' => array_map(fn ($t) => [
                'type' => $t,
                'label' => FieldType::label($t),
                'autofilled' => FieldType::isAutofilled($t),
            ], FieldType::ALL),
        ]);
    }

    /**
     * Replace the field set for a draft.
     *
     * Wholesale replace is safe here (unlike recipients, whose rows own
     * signing progress): fields carry no state until someone signs, and a
     * signed request is never editable.
     */
    public function store(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'fields' => ['present', 'array', 'max:200'],
            'fields.*.type' => ['required', 'in:'.implode(',', FieldType::ALL)],
            'fields.*.recipient' => ['required', 'string'],
            'fields.*.page' => ['required', 'integer', 'min:1', 'max:500'],
            // Fractions of the page, not pixels. The upper bounds allow a
            // field to sit flush against the right/bottom edge but not escape.
            'fields.*.x' => ['required', 'numeric', 'min:0', 'max:1'],
            'fields.*.y' => ['required', 'numeric', 'min:0', 'max:1'],
            'fields.*.width' => ['required', 'numeric', 'min:0.005', 'max:1'],
            'fields.*.height' => ['required', 'numeric', 'min:0.005', 'max:1'],
            'fields.*.required' => ['nullable', 'boolean'],
        ]);

        $signatureRequest = $this->findOwned($request, $uuid);
        abort_unless(
            $signatureRequest->status === Status::DRAFT,
            422,
            'Fields can only be changed while the request is a draft.',
        );

        // A field may only be assigned to a recipient of THIS request -
        // otherwise a crafted payload could hand someone else's signer a field
        // on a document they were never sent.
        $recipients = $signatureRequest->recipients()->get()->keyBy('uuid');

        foreach ($data['fields'] as $field) {
            abort_unless(
                $recipients->has($field['recipient']),
                422,
                'Every field must be assigned to a recipient on this request.',
            );
            // A field running off the page can't be stamped back onto it.
            abort_if(
                $field['x'] + $field['width'] > 1.0001 || $field['y'] + $field['height'] > 1.0001,
                422,
                'Fields must sit inside the page.',
            );
        }

        $signatureRequest->fields()->delete();

        foreach ($data['fields'] as $field) {
            $signatureRequest->fields()->create([
                'uuid' => (string) Str::uuid(),
                'signature_recipient_id' => $recipients->get($field['recipient'])->id,
                'type' => $field['type'],
                'page' => $field['page'],
                'x' => $field['x'],
                'y' => $field['y'],
                'width' => $field['width'],
                'height' => $field['height'],
                // Autofilled values always arrive, so "optional" is meaningless
                // for them; anything else honours the author's choice.
                'required' => FieldType::isAutofilled($field['type'])
                    ? true
                    : (bool) ($field['required'] ?? true),
            ]);
        }

        $signatureRequest->load('fields');

        return response()->json([
            'fields' => (new Presenter($request->user()))->fields($signatureRequest),
        ]);
    }

    private function findOwned(Request $request, string $uuid): SignatureRequest
    {
        $signatureRequest = SignatureRequest::query()->where('uuid', $uuid)->first();
        abort_unless($signatureRequest, 404, 'That signature request no longer exists.');

        $user = $request->user();
        abort_unless(
            $signatureRequest->created_by === $user->id || FileAccess::isAdmin($user),
            403,
            'You do not have access to this signature request.',
        );

        return $signatureRequest;
    }
}
