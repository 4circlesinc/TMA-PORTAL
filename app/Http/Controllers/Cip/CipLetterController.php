<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipDecisionTemplate;
use App\Support\Activity\ActivityLogger;
use App\Support\Cip\CipAccess;
use App\Support\Templates\Markup;
use App\Support\Cip\InvestmentType;
use App\Support\Cip\Letters;
use App\Support\Cip\Status;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Granted and Denied letters (§23).
 *
 * Ten templates, one pair per investment type. Reading is open to anyone who
 * may reach the module; rewriting is `cip.configure`, one edit is every
 * future decision letter, which is a different order of act from recording
 * one file's outcome.
 */
class CipLetterController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless(CipAccess::canReach($request->user()), 404);

        Letters::ensure();

        $all = CipDecisionTemplate::query()
            ->orderBy('id')
            ->get()
            ->groupBy('investment_type');

        return response()->json([
            'canEdit' => CipAccess::can($request->user(), 'cip.configure'),
            'placeholders' => Letters::placeholders(),
            'types' => collect(InvestmentType::ALL)->map(fn (string $label, string $type) => [
                'value' => $type,
                'label' => $label,
                'letters' => collect([Status::GRANTED, Status::DENIED])
                    ->map(fn (string $decision) => $all->get($type)?->firstWhere('decision', $decision))
                    ->filter()
                    ->map(fn (CipDecisionTemplate $letter) => $this->record($letter))
                    ->values()
                    ->all(),
            ])->values()->all(),
        ]);
    }

    public function update(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeManage($request);

        $letter = $this->find($uuid);

        $data = $request->validate([
            'title' => ['required', 'string', 'max:191'],
            'body' => ['required', 'string', 'max:20000'],
        ]);

        // A rich-editor letter is stored already sanitized, so nothing
        // unsafe ever sits in the row or reaches the editor reopening it.
        $body = trim($data['body']);
        if (Markup::looksLikeHtml($body)) {
            $body = Markup::sanitize($body);
        }

        $letter->forceFill([
            'title' => trim($data['title']),
            'body' => $body,
            'updated_by' => $request->user()->id,
        ])->save();

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'cip.letter_updated',
            'module' => 'cip',
            'description' => $letter->investmentTypeLabel().' '.$letter->decisionLabel().' letter updated',
            'subject' => $letter,
            'new' => ['title' => $letter->title],
        ]);

        return response()->json($this->record($letter->refresh()));
    }

    public function restore(Request $request, string $uuid): JsonResponse
    {
        $this->authorizeManage($request);

        $letter = Letters::restore($this->find($uuid), $request->user());

        ActivityLogger::log([
            'actor' => $request->user(),
            'type' => 'cip.letter_restored',
            'module' => 'cip',
            'description' => $letter->investmentTypeLabel().' '.$letter->decisionLabel().' letter restored to the default',
            'subject' => $letter,
        ]);

        return response()->json($this->record($letter));
    }

    private function authorizeManage(Request $request): void
    {
        $user = $request->user();
        abort_unless(CipAccess::canReach($user), 404);
        abort_unless(CipAccess::can($user, 'cip.configure'), 403, 'Only an administrator can change the decision letters.');
    }

    private function find(string $uuid): CipDecisionTemplate
    {
        return CipDecisionTemplate::query()->where('uuid', $uuid)->firstOrFail();
    }

    /** @return array<string, mixed> */
    private function record(CipDecisionTemplate $letter): array
    {
        return [
            'id' => $letter->uuid,
            'investmentType' => $letter->investment_type,
            'decision' => $letter->decision,
            'decisionLabel' => $letter->decisionLabel(),
            'title' => $letter->title,
            'body' => $letter->body,
            'customized' => Letters::isCustomized($letter),
        ];
    }
}
