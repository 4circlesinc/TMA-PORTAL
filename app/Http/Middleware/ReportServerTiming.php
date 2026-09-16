<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Say where a request's time went, on the response itself.
 *
 * `Server-Timing` is read by every browser's Network panel, so a slow screen
 * can be diagnosed from DevTools instead of reconstructed with a query log
 * in tinker: how many queries the request ran, how long the database took
 * in total, and how long PHP took around it. The rest of the wall-clock a
 * reader sees is the network, which the browser already measures.
 *
 * Three numbers, nothing sensitive: no SQL, no bindings, no identifiers.
 * Cheap enough to leave on everywhere - one listener adding two integers
 * per query.
 */
class ReportServerTiming
{
    public function handle(Request $request, Closure $next): Response
    {
        $queries = 0;
        $dbMs = 0.0;
        $slowestMs = 0.0;
        $slowestSql = null;

        DB::listen(function (QueryExecuted $event) use (&$queries, &$dbMs, &$slowestMs, &$slowestSql): void {
            $queries++;
            $dbMs += $event->time;

            if ($event->time > $slowestMs) {
                $slowestMs = $event->time;
                $slowestSql = $event->sql;
            }
        });

        $response = $next($request);

        // LARAVEL_START is stamped by public/index.php before the framework
        // boots, so this covers autoload and bootstrap as well as the route.
        $start = defined('LARAVEL_START') ? LARAVEL_START : $request->server('REQUEST_TIME_FLOAT');
        $totalMs = (microtime(true) - (float) $start) * 1000;

        $response->headers->set('Server-Timing', implode(', ', [
            sprintf('db;dur=%.1f;desc="%d queries"', $dbMs, $queries),
            sprintf('app;dur=%.1f;desc="php"', max(0, $totalMs - $dbMs)),
            sprintf('total;dur=%.1f', $totalMs),
        ]));

        /*
         * A request the load balancer gave up on never reaches a browser's
         * Network panel, so the server keeps its own record of the ones that
         * ran long. The slowest statement is logged as its shape, with the
         * placeholders and without the bindings, which is what separates "a
         * scan that grew with the data" from "many small queries" and names
         * the table without naming anyone in it.
         */
        $slowMs = (int) config('app.slow_request_ms', 5000);

        if ($slowMs > 0 && $totalMs >= $slowMs) {
            Log::warning('Slow request', [
                'method' => $request->method(),
                'path' => $request->path(),
                'user' => $request->user()?->id,
                'total_ms' => (int) round($totalMs),
                'db_ms' => (int) round($dbMs),
                'queries' => $queries,
                'slowest_ms' => (int) round($slowestMs),
                'slowest_sql' => $slowestSql === null ? null : mb_substr(preg_replace('/\s+/', ' ', $slowestSql), 0, 500),
            ]);
        }

        return $response;
    }
}
