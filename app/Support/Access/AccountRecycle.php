<?php

namespace App\Support\Access;

use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Clients\ClientDirectory;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Realtime\Live;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Park an account in the Recycle Bin rather than erasing it.
 *
 * Administrators do this from Users. A Service Provider admin may do it for
 * a contact at their own firm: the row survives for restore, but sessions
 * and live grants are settled so the person cannot keep acting.
 */
final class AccountRecycle
{
    public static function park(User $user, User $actor): void
    {
        abort_if($user->id === $actor->id, 422, 'You cannot remove your own access.');

        DB::table('sessions')->where('user_id', $user->id)->delete();
        AccessSync::userSuspended($user, $actor);

        if ($user->email) {
            Deliveries::send(
                Postcards::accountDeleted($user->email, $user->first_name ?: null),
                $user->email,
                $user,
                'accountDeleted',
                immediate: true,
            );
        }

        $user->forceFill(['deleted_by' => $actor->id])->save();
        $user->delete();

        ClientDirectory::flush();
        Cache::forget('companies.directory');
        Live::staff(Live::CLIENTS);
        Live::staff(Live::COMPANIES);
        Live::staff(Live::CIP);

        ActivityLogger::log([
            'actor' => $actor,
            'type' => 'account.deleted',
            'module' => 'account',
            'description' => $actor->name.' moved the account for '.$user->email.' to the Recycle Bin',
            'subject' => $user,
        ]);
    }
}
