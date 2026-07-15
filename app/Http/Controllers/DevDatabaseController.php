<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\View\View;

/**
 * Read-only database browser for local development. Never registered outside
 * the local environment; still gated to administrators, and sensitive columns
 * (secrets, tokens, hashes) are redacted before they ever reach the page.
 */
class DevDatabaseController extends Controller
{
    private const SENSITIVE = [
        'password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes',
        'token', 'payload', 'token_hash', 'secret',
    ];

    private const ROW_LIMIT = 200;

    public function __invoke(Request $request): View
    {
        abort_unless($request->user()?->account_type === 'Administrator', 403, 'Administrators only.');

        $tables = collect(Schema::getTableListing())
            // strip the SQLite schema prefix ("main.users" -> "users")
            ->map(fn (string $t) => str_contains($t, '.') ? substr($t, strrpos($t, '.') + 1) : $t)
            ->reject(fn (string $t) => str_starts_with($t, 'sqlite_'))
            ->unique()
            ->sort()
            ->values()
            ->map(fn (string $t) => [
                'name' => $t,
                'count' => DB::table($t)->count(),
            ]);

        $active = $request->query('table', 'users');
        if (! $tables->contains(fn ($t) => $t['name'] === $active)) {
            $active = $tables->first()['name'] ?? null;
        }

        $columns = [];
        $rows = [];
        $total = 0;

        if ($active) {
            $columns = Schema::getColumnListing($active);
            $total = DB::table($active)->count();
            $rows = DB::table($active)
                ->limit(self::ROW_LIMIT)
                ->get()
                ->map(function ($row) {
                    $out = [];
                    foreach ((array) $row as $col => $value) {
                        $out[$col] = $this->present($col, $value);
                    }

                    return $out;
                });
        }

        return view('dev.database', [
            'tables' => $tables,
            'active' => $active,
            'columns' => $columns,
            'rows' => $rows,
            'total' => $total,
            'limit' => self::ROW_LIMIT,
        ]);
    }

    private function present(string $column, mixed $value): string
    {
        if (in_array($column, self::SENSITIVE, true) && $value !== null && $value !== '') {
            return '•••• hidden ••••';
        }

        if ($value === null) {
            return '—';
        }

        $value = (string) $value;

        return mb_strlen($value) > 120 ? mb_substr($value, 0, 120).'…' : $value;
    }
}
