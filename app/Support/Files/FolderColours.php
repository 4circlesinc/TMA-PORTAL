<?php

namespace App\Support\Files;

use App\Models\Folder;
use App\Models\FolderColourPreference;
use App\Models\User;

/**
 * The approved folder colour palette, plus the rule for which colour
 * actually applies to a given viewer: default/system folders show the
 * one admin-set colour (folders.colour); regular user folders show the
 * viewer's own preference, or nothing (today's plain look) if they never
 * set one.
 */
class FolderColours
{
    public const PALETTE = [
        'default' => ['fill' => '#fec656', 'shade' => '#ef9f2c', 'label' => 'Default'],
        'blue' => ['fill' => '#7dbbff', 'shade' => '#03a5e9', 'label' => 'Blue'],
        'green' => ['fill' => '#71dd8c', 'shade' => '#3fae63', 'label' => 'Green'],
        'pink' => ['fill' => '#ff90e8', 'shade' => '#d954b8', 'label' => 'Pink'],
        'red' => ['fill' => '#ff4747', 'shade' => '#d62d2d', 'label' => 'Red'],
        'teal' => ['fill' => '#6be6d3', 'shade' => '#2fb39d', 'label' => 'Teal'],
    ];

    public static function effective(Folder $folder, ?string $preference): ?string
    {
        return $folder->folder_type === Folder::TYPE_USER ? $preference : $folder->colour;
    }

    /**
     * Batch-load this viewer's personal colour + icon preferences for a set
     * of folder ids in one query. folder_id => ['colour' => ?, 'iconName' => ?].
     */
    public static function preferenceRows(User $user, array $folderIds): array
    {
        if (! $folderIds) {
            return [];
        }

        return FolderColourPreference::where('user_id', $user->id)
            ->whereIn('folder_id', $folderIds)
            ->get(['folder_id', 'colour', 'icon_name'])
            ->mapWithKeys(fn (FolderColourPreference $p) => [
                $p->folder_id => ['colour' => $p->colour, 'iconName' => $p->icon_name],
            ])->all();
    }
}
