<?php

namespace App\Http\Controllers\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Files\Activity;
use App\Support\Files\FileAccess;
use App\Support\Files\Sharing;
use App\Support\Notifications\Notifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class ShareController extends BaseFilesController
{
    /** Who currently has access to an item (people + the public link). */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:file,folder'],
            'id' => ['required', 'string'],
        ]);

        $item = $this->item($data['type'], $data['id']);
        FileAccess::authorize($this->user($request), 'share', $item);

        return response()->json($this->access($item, $data['type']));
    }

    /** Invite a person by email, or create/refresh the public link. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:file,folder'],
            'id' => ['required', 'string'],
            'mode' => ['required', 'in:invite,link'],
            'role' => ['required', 'in:'.implode(',', Sharing::ROLES)],
            'email' => ['required_if:mode,invite', 'nullable', 'email'],
            'expiresAt' => ['nullable', 'date'],
            'password' => ['nullable', 'string', 'min:1', 'max:128'],
            'allowDownload' => ['nullable', 'boolean'],
        ]);

        $user = $this->user($request);
        $item = $this->item($data['type'], $data['id']);
        FileAccess::authorize($user, 'share', $item);

        if ($data['mode'] === 'invite') {
            $this->invite($user, $item, $data['type'], $data);
        } else {
            $this->link($user, $item, $data['type'], $data);
        }

        return response()->json($this->access($item, $data['type']), 201);
    }

    /** Change a share's role / expiry / password / download flag. */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $data = $request->validate([
            'role' => ['sometimes', 'in:'.implode(',', Sharing::ROLES)],
            'expiresAt' => ['sometimes', 'nullable', 'date'],
            'password' => ['sometimes', 'nullable', 'string', 'max:128'],
            'allowDownload' => ['sometimes', 'boolean'],
        ]);

        [$share, $item, $type] = $this->manageable($request, $uuid);

        if (array_key_exists('role', $data)) {
            $share->role = $data['role'];
        }
        if (array_key_exists('expiresAt', $data)) {
            $share->expires_at = $data['expiresAt'] ? Carbon::parse($data['expiresAt']) : null;
        }
        if (array_key_exists('password', $data)) {
            $share->password_hash = ($data['password'] ?? '') !== '' ? Hash::make($data['password']) : null;
        }
        if (array_key_exists('allowDownload', $data)) {
            $share->allow_download = (bool) $data['allowDownload'];
        }
        $share->save();

        return response()->json($this->access($item, $type));
    }

    /** Revoke a share (person removed, or link disabled). */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        [$share, $item, $type] = $this->manageable($request, $uuid);

        $share->update(['revoked_at' => now()]);
        Activity::log($this->user($request)->id, $type, $item->id, 'permission', ['revoked' => $share->kind]);

        return response()->json($this->access($item, $type));
    }

    /* ── helpers ─────────────────────────────────────── */

    private function invite(User $user, FileItem|Folder $item, string $type, array $data): void
    {
        $email = Str::lower(trim($data['email']));
        $target = User::where('email', $email)->first();

        // Re-use an existing active share to the same person, else create one.
        $share = Share::query()
            ->where('item_type', $type)->where('item_id', $item->id)
            ->whereNull('revoked_at')
            ->when($target, fn ($q) => $q->where('kind', 'user')->where('target_user_id', $target->id))
            ->when(! $target, fn ($q) => $q->where('kind', 'email')->where('target_email', $email))
            ->first();

        if ($share) {
            $share->update(['role' => $data['role']]);
        } else {
            $share = Share::create([
                'uuid' => (string) Str::uuid(),
                'token' => Sharing::token(),
                'item_type' => $type,
                'item_id' => $item->id,
                'shared_by' => $user->id,
                'kind' => $target ? 'user' : 'email',
                'target_user_id' => $target?->id,
                'target_email' => $target ? null : $email,
                'role' => $data['role'],
                'allow_download' => true,
            ]);
        }

        Activity::log($user->id, $type, $item->id, 'assign', ['to' => $email, 'role' => $data['role']]);

        // Portal-wide audit entry (feeds the Overview log) and a notification to
        // the person the item was shared with, when they're a real account (§13).
        ActivityLogger::log([
            'actor' => $user,
            'type' => $type === 'folder' ? 'folder.shared' : 'file.shared',
            'description' => $user->name.' shared '.($type === 'folder' ? 'folder ' : '').'"'.$item->name.'" with '.$email,
            'subject' => $item,
            'new' => ['role' => $data['role']],
        ]);

        if ($target) {
            Notifier::send([
                'user' => $target,
                'actor' => $user,
                'type' => $type === 'folder' ? 'folder.shared' : 'file.shared',
                'title' => $user->name.' shared '.($type === 'folder' ? 'a folder' : 'a file').' with you: '.$item->name,
                'subject' => $item,
                'action_url' => '/portal/files',
                'dedupe_key' => 'share:'.$type.':'.$item->id.':'.$target->id,
            ]);
        }
    }

    private function link(User $user, FileItem|Folder $item, string $type, array $data): void
    {
        $share = Share::query()
            ->where('item_type', $type)->where('item_id', $item->id)
            ->where('kind', 'link')->whereNull('revoked_at')->first();

        $attributes = [
            'role' => $data['role'],
            'allow_download' => $data['allowDownload'] ?? true,
            'expires_at' => ! empty($data['expiresAt']) ? Carbon::parse($data['expiresAt']) : null,
        ];
        if (array_key_exists('password', $data)) {
            $attributes['password_hash'] = ($data['password'] ?? '') !== '' ? Hash::make($data['password']) : null;
        }

        if ($share) {
            $share->update($attributes);
        } else {
            Share::create(array_merge($attributes, [
                'uuid' => (string) Str::uuid(),
                'token' => Sharing::token(),
                'item_type' => $type,
                'item_id' => $item->id,
                'shared_by' => $user->id,
                'kind' => 'link',
            ]));
        }

        Activity::log($user->id, $type, $item->id, 'share', ['link' => true]);
    }

    /** Load a share the current user is allowed to manage, with its item. */
    private function manageable(Request $request, string $uuid): array
    {
        $share = Share::where('uuid', $uuid)->firstOr(fn () => abort(404, 'Share not found.'));
        $item = $this->item($share->item_type, null, $share->item_id);
        abort_unless(Sharing::canManage($this->user($request), $share, $item), 403, 'Permission denied.');

        return [$share, $item, $share->item_type];
    }

    private function item(string $type, ?string $uuid, ?int $id = null): FileItem|Folder
    {
        $model = $type === 'folder' ? Folder::query() : FileItem::query();
        $query = $id !== null ? $model->where('id', $id) : $model->where('uuid', $uuid);

        return $query->firstOr(fn () => abort(404, ucfirst($type).' not found.'));
    }

    private function access(FileItem|Folder $item, string $type): array
    {
        $shares = Share::query()
            ->where('item_type', $type)->where('item_id', $item->id)
            ->whereNull('revoked_at')
            ->with('targetUser:id,name,email,avatar_url')
            ->get()
            ->filter(fn (Share $s) => $s->isActive());

        $owner = $item->owner;
        $link = $shares->firstWhere('kind', 'link');

        return [
            'owner' => $owner ? ['name' => $owner->name, 'email' => $owner->email, 'avatar' => $owner->avatar_url] : null,
            'people' => $shares->whereIn('kind', ['user', 'email'])->map(fn (Share $s) => Sharing::present($s))->values(),
            'link' => $link ? Sharing::present($link) : null,
            'roles' => Sharing::ROLES,
        ];
    }
}
