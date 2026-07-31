<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person's progress through guided onboarding.
 *
 * Deliberately dumb: it stores answers and which steps are done, and knows
 * nothing about what the steps mean. The flow itself — which steps exist, which
 * apply, what each one validates — lives in App\Support\Onboarding\ClientFlow,
 * so changing the questions never means a migration.
 */
#[Fillable(['user_id', 'flow', 'current_step', 'completed_steps', 'answers', 'started_at', 'completed_at'])]
class OnboardingProgress extends Model
{
    protected $table = 'onboarding_progress';

    public const FLOW_CLIENT = 'client';

    public const FLOW_STAFF = 'staff';

    protected function casts(): array
    {
        return [
            'completed_steps' => 'array',
            'answers' => 'array',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<int, string> */
    public function done(): array
    {
        return array_values(array_unique($this->completed_steps ?? []));
    }

    public function hasDone(string $step): bool
    {
        return in_array($step, $this->done(), true);
    }

    /** Everything answered so far, or one step's answers. */
    public function answers(?string $step = null): array
    {
        $all = $this->answers ?? [];

        return $step === null ? $all : ($all[$step] ?? []);
    }

    /** Record one step's answers and mark it done. */
    public function remember(string $step, array $values): self
    {
        $answers = $this->answers ?? [];
        $answers[$step] = $values;

        $done = $this->done();
        if (! in_array($step, $done, true)) {
            $done[] = $step;
        }

        $this->forceFill([
            'answers' => $answers,
            'completed_steps' => $done,
        ])->save();

        return $this;
    }

    public function isComplete(): bool
    {
        return $this->completed_at !== null;
    }
}
