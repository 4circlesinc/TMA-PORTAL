<?php

namespace App\Http\Controllers\Files;

use App\Models\Favorite;
use App\Support\Files\FileAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FavoriteController extends BaseFilesController
{
    /** Toggle a file/folder in the current user's favourites. */
    public function toggle(Request $request): JsonResponse
    {
        $request->validate([
            'type' => ['required', 'in:file,folder'],
            'id' => ['required', 'string'],
        ]);

        $user = $this->user($request);
        $type = $request->input('type');

        $item = $type === 'file'
            ? $this->findFile($request->input('id'))
            : $this->findFolder($request->input('id'));

        FileAccess::authorize($user, 'view', $item);

        $existing = Favorite::where('user_id', $user->id)
            ->where('item_type', $type)
            ->where('item_id', $item->id)
            ->first();

        if ($existing) {
            $existing->delete();
            $favorite = false;
        } else {
            Favorite::create(['user_id' => $user->id, 'item_type' => $type, 'item_id' => $item->id]);
            $favorite = true;
        }

        return response()->json(['favorite' => $favorite]);
    }
}
