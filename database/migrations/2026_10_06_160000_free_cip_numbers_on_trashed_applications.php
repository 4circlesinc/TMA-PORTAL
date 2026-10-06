<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Soft-deleted applications used to keep their CIP number, so the unique
 * index blocked that Unit number while the file sat invisible in the recycle
 * bin. Clear those numbers; new deletes store the value on the deleted event
 * and put it back on restore.
 */
return new class extends Migration
{
    public function up(): void
    {
        $rows = DB::table('cip_applications')
            ->whereNotNull('deleted_at')
            ->whereNotNull('cip_number')
            ->where('cip_number', '!=', '')
            ->orderBy('id')
            ->get(['id', 'cip_number', 'internal_number', 'status']);

        foreach ($rows as $row) {
            $meta = [
                'cipNumber' => $row->cip_number,
                'internalNumber' => $row->internal_number,
                'status' => $row->status,
                'freedOnSoftDelete' => true,
            ];

            DB::table('cip_events')->insert([
                'application_id' => $row->id,
                'actor_id' => null,
                'company_member_id' => null,
                'actor_name' => null,
                'action' => 'deleted',
                'from_status' => null,
                'to_status' => null,
                'detail' => null,
                'meta' => json_encode($meta),
                'ip_address' => null,
                'created_at' => now(),
            ]);

            DB::table('cip_applications')
                ->where('id', $row->id)
                ->update(['cip_number' => null]);
        }
    }

    public function down(): void
    {
        // Numbers freed from trashed rows are not put back: another live file
        // may already hold them.
    }
};
