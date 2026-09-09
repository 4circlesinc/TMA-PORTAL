<?php

namespace Database\Seeders;

use App\Support\Cip\Letters;
use Illuminate\Database\Seeder;

/**
 * The twenty Granted / Denied letters (section 23): a pair per investment
 * type, in each of the two lanes.
 *
 * firstOrCreate on investment type + phase + outcome, so a letter the firm
 * has rewritten in Account settings is never written back over.
 */
class CipDecisionTemplateSeeder extends Seeder
{
    public function run(): void
    {
        Letters::ensure();
    }
}
