<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Company;
use App\Support\Cip\ProviderMerge;
use App\Support\Cip\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ProviderMergeTest extends TestCase
{
    use RefreshDatabase;

    public function test_duplicate_firms_join_the_one_that_remains(): void
    {
        $company = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        $kept = CipProvider::create([
            'name' => 'iGraphix', 'code' => 'IGA', 'company_id' => $company->id, 'active' => true,
        ]);
        $typo = CipProvider::create([
            'name' => 'iGaphix', 'code' => 'IGAP', 'active' => true,
        ]);
        $respect = CipProvider::create([
            'name' => 'Respect Services', 'code' => 'RES', 'active' => true,
        ]);
        $longer = CipProvider::create([
            'name' => 'Respect Services', 'code' => 'RESP', 'active' => true,
        ]);
        $numbered = CipProvider::create([
            'name' => 'Respect Services 3', 'code' => 'RESPE', 'active' => true,
        ]);
        $distinct = CipProvider::create([
            'name' => 'Soland World - High Volume', 'code' => 'SOL', 'active' => true,
        ]);
        $plain = CipProvider::create([
            'name' => 'Soland World', 'code' => 'SOLAN', 'active' => true,
        ]);

        $filed = new CipApplication([
            'provider_id' => $longer->id,
            'status' => Status::NEW,
        ]);
        $filed->forceFill(['internal_number' => 'RESP26-00001'])->save();
        DB::table('cip_counters')->insert([
            'provider_id' => $longer->id,
            'year' => 2026,
            'last_sequence' => 4,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('cip_counters')->insert([
            'provider_id' => $respect->id,
            'year' => 2026,
            'last_sequence' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        ProviderMerge::run();

        $this->assertSame($respect->id, $filed->fresh()->provider_id);
        $this->assertSame('RESP26-00001', $filed->fresh()->internal_number);
        $this->assertNull(CipProvider::find($longer->id));
        $this->assertNull(CipProvider::find($numbered->id));
        $this->assertSame('RES', $respect->fresh()->code);
        $this->assertSame(4, (int) DB::table('cip_counters')->where('provider_id', $respect->id)->value('last_sequence'));

        $this->assertNull(CipProvider::find($typo->id));
        $this->assertNotNull(CipProvider::find($kept->id));

        $this->assertNotNull(CipProvider::find($distinct->id));
        $this->assertNotNull(CipProvider::find($plain->id));
    }
}
