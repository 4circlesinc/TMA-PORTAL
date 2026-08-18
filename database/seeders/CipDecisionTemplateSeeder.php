<?php

namespace Database\Seeders;

use App\Support\Cip\Letters;
use Illuminate\Database\Seeder;

/**
 * The ten Granted / Denied letters (§23).
 *
 * firstOrCreate on investment type + outcome, so a letter the firm has
 * rewritten in Account settings is never written back over.
 */
class CipDecisionTemplateSeeder extends Seeder
{
    public function run(): void
    {
        Letters::ensure();
    }
}
