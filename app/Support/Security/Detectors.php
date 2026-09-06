<?php

namespace App\Support\Security;

use App\Models\AuthEvent;
use App\Models\FileActivity;
use App\Models\User;
use App\Support\SecurityPolicies;
use Illuminate\Support\Facades\Cache;

/**
 * Turns the admin "auto-remediation" toggles into real alerts.
 *
 * None of these lock an account (that would strand the firm). They fan out
 * the same way failed sign-ins already do.
 */
final class Detectors
{
    public static function countryFromRequest(): ?string
    {
        $header = strtoupper(trim((string) request()?->header('CF-IPCountry', '')));
        if ($header !== '' && $header !== 'XX' && strlen($header) === 2) {
            return $header;
        }

        return null;
    }

    public static function onLogin(User $user, ?string $country, string $ip): void
    {
        $flags = SecurityPolicies::get('security')['autoRemediation'] ?? [];

        if (! empty($flags['impossibleTravel'])) {
            self::impossibleTravel($user, $country);
        }

        if (! empty($flags['ipCountChange'])) {
            self::ipCountChange($user);
        }

        if (! empty($flags['suspiciousIp'])) {
            self::suspiciousIp($ip, $user);
        }
    }

    public static function onFileDownload(int $userId): void
    {
        $flags = SecurityPolicies::get('security')['autoRemediation'] ?? [];
        if (empty($flags['downloadTrend'])) {
            return;
        }

        $user = User::query()->find($userId);
        if (! $user) {
            return;
        }

        $key = 'security.download-trend.'.$userId;
        if (! Cache::add($key, 1, now()->addMinutes(10))) {
            return;
        }

        $count = FileActivity::query()
            ->where('user_id', $userId)
            ->where('action', 'download')
            ->where('created_at', '>=', now()->subMinutes(10))
            ->count();

        if ($count < 40) {
            Cache::forget($key);

            return;
        }

        SecurityAlertPolicy::fanOut(
            'downloadTrend',
            $user,
            'Unusual download volume on '.$user->name.'’s account',
            $count.' file downloads in 10 minutes from '.(request()?->ip() ?: 'an unknown address').'.',
        );
        SecurityAudit::record('security.download_trend', [
            'user_id' => $userId,
            'count' => $count,
        ]);
    }

    private static function impossibleTravel(User $user, ?string $country): void
    {
        if ($country === null) {
            return;
        }

        $previous = AuthEvent::query()
            ->where('user_id', $user->id)
            ->where('event', 'login')
            ->whereNotNull('country')
            ->where('country', '!=', '')
            ->orderByDesc('id')
            ->skip(1)
            ->first();

        if (! $previous || $previous->country === $country) {
            return;
        }

        $minutes = $previous->created_at?->diffInMinutes(now()) ?? 9999;
        if ($minutes > 180) {
            return;
        }

        SecurityAlertPolicy::fanOut(
            'impossibleTravel',
            $user,
            'Sign-in from a new country on '.$user->name.'’s account',
            'Previous country '.$previous->country.', now '.$country.', '.$minutes.' minutes apart.',
        );
        SecurityAudit::record('security.impossible_travel', [
            'user_id' => $user->id,
            'from' => $previous->country,
            'to' => $country,
            'minutes' => $minutes,
        ]);
    }

    private static function ipCountChange(User $user): void
    {
        $key = 'security.ip-count.'.$user->id.'.'.now()->toDateString();
        if (! Cache::add($key, 1, now()->endOfDay())) {
            return;
        }

        $ips = AuthEvent::query()
            ->where('user_id', $user->id)
            ->where('event', 'login')
            ->where('created_at', '>=', now()->subDay())
            ->distinct()
            ->count('ip');

        if ($ips < 6) {
            Cache::forget($key);

            return;
        }

        SecurityAlertPolicy::fanOut(
            'ipCountChange',
            $user,
            'Many networks used on '.$user->name.'’s account',
            $ips.' distinct IP addresses in 24 hours.',
        );
        SecurityAudit::record('security.ip_count_change', [
            'user_id' => $user->id,
            'ips' => $ips,
        ]);
    }

    private static function suspiciousIp(string $ip, User $subject): void
    {
        if ($ip === '') {
            return;
        }

        $key = 'security.suspicious-ip.'.$ip;
        if (! Cache::add($key, 1, now()->addHour())) {
            return;
        }

        $accounts = AuthEvent::query()
            ->where('event', 'login_failed')
            ->where('ip', $ip)
            ->where('created_at', '>=', now()->subHour())
            ->whereNotNull('user_id')
            ->distinct()
            ->count('user_id');

        if ($accounts < 3) {
            Cache::forget($key);

            return;
        }

        SecurityAlertPolicy::fanOut(
            'suspiciousIp',
            $subject,
            'One address attacking several accounts',
            $ip.' failed sign-in against '.$accounts.' accounts in an hour.',
        );
        SecurityAudit::record('security.suspicious_ip', [
            'ip' => $ip,
            'accounts' => $accounts,
        ]);
    }
}
