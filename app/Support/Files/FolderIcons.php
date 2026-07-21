<?php

namespace App\Support\Files;

use App\Models\Folder;

/**
 * The approved, curated set of Phosphor icons a folder's front panel may be
 * stamped with — not the full ~1600-icon library. Every name here is a
 * verified single-path `fill="currentColor"` phosphor SVG (mask-friendly),
 * living at public/images/icons/phosphor/{name}.svg. Mirrored client-side
 * in public/js/folder-icons.js - keep both in sync by hand.
 */
class FolderIcons
{
    public const CATEGORIES = [
        'Documents' => ['File', 'FileText', 'Files', 'FilePdf', 'FileDoc', 'Clipboard', 'Notepad', 'BookOpen'],
        'Clients' => ['AddressBook', 'Briefcase', 'Buildings', 'Handshake', 'IdentificationCard', 'Storefront'],
        'Users' => ['User', 'UsersThree', 'UserCircle', 'UserGear', 'UserList', 'UserPlus'],
        'Finance' => ['CurrencyDollar', 'Wallet', 'ChartLine', 'Coins', 'Receipt', 'PiggyBank', 'Bank'],
        'Contracts' => ['Scroll', 'Gavel', 'Stamp', 'SealCheck'],
        'Signatures' => ['Signature', 'PenNib', 'Pen', 'PencilSimple'],
        'Images' => ['Image', 'ImageSquare', 'Images', 'Camera'],
        'Videos' => ['VideoCamera', 'FilmSlate', 'PlayCircle', 'Playlist'],
        'Marketing' => ['Megaphone', 'Rocket', 'TrendUp', 'Target', 'Sparkle'],
        'Projects' => ['Kanban', 'ListChecks', 'Flag', 'FlagCheckered', 'Path'],
        'Reports' => ['ChartBar', 'ChartPie', 'ChartDonut', 'Table', 'PresentationChart'],
        'Legal' => ['Scales', 'Gavel', 'Certificate', 'Shield', 'ShieldCheck'],
        'Archive' => ['Archive', 'ArchiveBox', 'ArchiveTray', 'Package'],
        'Settings' => ['Gear', 'GearSix', 'Sliders', 'Wrench', 'Toolbox'],
        'Calendar' => ['Calendar', 'CalendarBlank', 'CalendarCheck', 'Clock', 'Alarm'],
        'Communication' => ['ChatCircle', 'ChatDots', 'Envelope', 'Phone', 'Bell', 'At'],
    ];

    public static function all(): array
    {
        return array_values(array_unique(array_merge(...array_values(self::CATEGORIES))));
    }

    public static function isValid(?string $name): bool
    {
        return $name === null || in_array($name, self::all(), true);
    }

    public static function effective(Folder $folder, ?string $preference): ?string
    {
        return $folder->folder_type === Folder::TYPE_USER ? $preference : $folder->icon_name;
    }
}
