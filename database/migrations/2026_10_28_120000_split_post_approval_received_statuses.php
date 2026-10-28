<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The post-approval lane now stops on the thing that arrived.
 *
 * Recording COR received used to jump straight to Apply for NIC, NIC
 * received to Apply for Passport, a passport in the office to Ready for
 * Delivery, and a delivered passport to Closed. Each of those arrivals is
 * its own status now. Rows already sitting on the old names move across;
 * a file closed because the lane denied it, with no delivery date, stays
 * Closed.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('cip_applications')
            ->where('status', 'ready_for_delivery')
            ->update(['status' => 'passport_received']);

        DB::table('cip_applications')
            ->where('phase', 'post_approval')
            ->where('status', 'closed')
            ->whereNotNull('passport_delivered_at')
            ->update(['status' => 'passport_delivered']);

        DB::table('cip_people')
            ->where('post_approval_status', 'ready_for_delivery')
            ->update(['post_approval_status' => 'passport_received']);

        DB::table('cip_people')
            ->where('post_approval_status', 'closed')
            ->whereNull('post_approval_apart')
            ->whereNotNull('post_approval_dates')
            ->lazyById()
            ->each(function (object $person): void {
                $dates = json_decode((string) $person->post_approval_dates, true);

                if (! is_array($dates) || empty($dates['passport_delivered'])) {
                    return;
                }

                DB::table('cip_people')
                    ->where('id', $person->id)
                    ->update(['post_approval_status' => 'passport_delivered']);
            });
    }

    public function down(): void
    {
        DB::table('cip_applications')
            ->where('status', 'passport_received')
            ->update(['status' => 'ready_for_delivery']);

        DB::table('cip_applications')
            ->where('status', 'passport_delivered')
            ->update(['status' => 'closed']);

        DB::table('cip_people')
            ->where('post_approval_status', 'passport_received')
            ->update(['post_approval_status' => 'ready_for_delivery']);

        DB::table('cip_people')
            ->where('post_approval_status', 'passport_delivered')
            ->update(['post_approval_status' => 'closed']);
    }
};
