<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\AdminRecycleBin;
use App\Support\Files\FileAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Firm-wide Recycle Bin for administrators (Overview → Recycle Bin).
 *
 * Soft-deleted files, folders, clients, signatures, groups, calendar events,
 * and message attachments. Email and chat messages themselves are excluded.
 */
class AdminRecycleBinController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:200'],
            'kind' => ['nullable', 'string', 'in:'.implode(',', AdminRecycleBin::KINDS)],
        ]);

        $result = AdminRecycleBin::list(
            search: $data['search'] ?? null,
            kind: $data['kind'] ?? null,
        );

        return response()->json([
            'items' => $result['items'],
            'total' => $result['total'],
            'kinds' => AdminRecycleBin::KINDS,
            'isAdmin' => true,
        ]);
    }

    public function restore(Request $request, string $kind, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);
        abort_unless(in_array($kind, AdminRecycleBin::KINDS, true), 404);

        AdminRecycleBin::restore($kind, $id);

        return response()->json(['ok' => true, 'restored' => ['kind' => $kind, 'id' => $id]]);
    }

    public function purge(Request $request, string $kind, string $id): JsonResponse
    {
        $this->authorizeAdmin($request);
        abort_unless(in_array($kind, AdminRecycleBin::KINDS, true), 404);

        AdminRecycleBin::purge($kind, $id);

        return response()->json(['ok' => true, 'purged' => ['kind' => $kind, 'id' => $id]]);
    }

    public function empty(Request $request): JsonResponse
    {
        $this->authorizeAdmin($request);

        $data = $request->validate([
            'kinds' => ['nullable', 'array'],
            'kinds.*' => ['string', 'in:'.implode(',', AdminRecycleBin::KINDS)],
        ]);

        $counts = AdminRecycleBin::empty($data['kinds'] ?? null);

        return response()->json(['ok' => true, 'counts' => $counts]);
    }

    private function authorizeAdmin(Request $request): void
    {
        abort_unless(Role::can($request->user(), 'recyclebin.admin'), 403, 'Only administrators can manage the recycle bin.');
    }
}
