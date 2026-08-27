<?php

use App\Models\CipDecisionTemplate;
use App\Support\Cip\Letters;
use App\Support\Cip\Status;
use Illuminate\Database\Migrations\Migration;

/**
 * Replace the placeholder one-line decision letters with the firm’s official
 * Granted / Denied emails, but only on rows nobody has rewritten.
 *
 * firstOrCreate will not touch existing rows, so a re-seed cannot do this.
 * Matching the previous default body is the test that the letter is still
 * the shipped placeholder and not the administrator’s copy.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (Letters::previousDefaults() as $type => $outcomes) {
            foreach ($outcomes as $decision => $oldBody) {
                $copy = Letters::defaults()[$type][$decision] ?? null;

                if ($copy === null) {
                    continue;
                }

                CipDecisionTemplate::query()
                    ->where('investment_type', $type)
                    ->where('decision', $decision)
                    ->where('body', $oldBody)
                    ->update([
                        'title' => $copy['title'],
                        'body' => $copy['body'],
                    ]);
            }
        }
    }

    public function down(): void
    {
        foreach (Letters::previousDefaults() as $type => $outcomes) {
            foreach ($outcomes as $decision => $oldBody) {
                $copy = Letters::defaults()[$type][$decision] ?? null;

                if ($copy === null) {
                    continue;
                }

                CipDecisionTemplate::query()
                    ->where('investment_type', $type)
                    ->where('decision', $decision)
                    ->where('body', $copy['body'])
                    ->update([
                        'title' => $decision === Status::GRANTED
                            ? '{{number}} was granted'
                            : '{{number}} was denied',
                        'body' => $oldBody,
                    ]);
            }
        }
    }
};
