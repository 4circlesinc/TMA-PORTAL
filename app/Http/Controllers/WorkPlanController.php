<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WorkDay;
use App\Support\Access\Role;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class WorkPlanController extends Controller
{
    /** Work plan rows (and weekday defaults) for a date range — calendar month. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
            'userId' => ['sometimes', 'integer'],
        ]);

        $target = $user;
        if (! empty($data['userId']) && (int) $data['userId'] !== (int) $user->id) {
            abort_unless(
                Role::can($user, 'presence.view'),
                403,
                'You cannot view that work plan.'
            );
            $target = User::findOrFail($data['userId']);
        }

        $from = CarbonImmutable::parse($data['from'])->startOfDay();
        $to = CarbonImmutable::parse($data['to'])->startOfDay();
        // A padded month window (~40 days) is normal; allow a little headroom
        // for timezone edges without accepting unbounded scans.
        abort_if($from->diffInDays($to) > 93, 422, 'That date range is too wide.');

        $stored = WorkDay::query()
            ->where('user_id', $target->id)
            ->whereBetween('work_date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->keyBy(fn (WorkDay $d) => $d->work_date->toDateString());

        $days = [];
        for ($cursor = $from; $cursor->lte($to); $cursor = $cursor->addDay()) {
            $key = $cursor->toDateString();
            $days[] = $stored->has($key)
                ? $stored[$key]->toRecord()
                : WorkDay::resolveFor($target, $cursor);
        }

        return response()->json([
            'days' => $days,
            'statuses' => collect(WorkDay::STATUSES)->map(fn ($s) => [
                'id' => $s,
                'label' => WorkDay::labelFor($s),
            ])->values(),
            'today' => WorkDay::resolveFor($target, CarbonImmutable::now()),
        ]);
    }

    public function show(Request $request, string $date): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'day' => WorkDay::resolveFor($user, $date),
            'statuses' => collect(WorkDay::STATUSES)->map(fn ($s) => [
                'id' => $s,
                'label' => WorkDay::labelFor($s),
            ])->values(),
        ]);
    }

    public function upsert(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'date' => ['required', 'date'],
            'status' => ['required', Rule::in(WorkDay::STATUSES)],
            'startsAt' => ['nullable', 'date_format:H:i'],
            'endsAt' => ['nullable', 'date_format:H:i'],
            'location' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string', 'max:500'],
            'visibility' => ['sometimes', Rule::in(['private', 'colleagues'])],
        ]);

        $day = WorkDay::updateOrCreate(
            [
                'user_id' => $user->id,
                'work_date' => CarbonImmutable::parse($data['date'])->toDateString(),
            ],
            [
                'status' => $data['status'],
                'starts_at' => $data['startsAt'] ?? null,
                'ends_at' => $data['endsAt'] ?? null,
                'location' => $data['location'] ?? null,
                'note' => $data['note'] ?? null,
                'visibility' => $data['visibility'] ?? 'colleagues',
            ]
        );

        return response()->json(['day' => $day->fresh()->toRecord()]);
    }

    public function destroy(Request $request, string $date): JsonResponse
    {
        WorkDay::query()
            ->where('user_id', $request->user()->id)
            ->whereDate('work_date', CarbonImmutable::parse($date)->toDateString())
            ->delete();

        return response()->json([
            'day' => WorkDay::resolveFor($request->user(), $date),
        ]);
    }
}
