<?php

namespace App\Support\Notifications;

use App\Models\Notification;

/**
 * The registry of every notification type the portal can raise (§13–§15).
 *
 * One place decides, per type: which module it belongs to, its semantic level
 * (§14, which drives the icon tone — never a bespoke colour), the fallback
 * system icon used when there is no human actor (§3), the default action label
 * (§15), the priority, and which user preference group can silence it (§21).
 *
 * Icon names are Phosphor SVG basenames that exist in
 * public/images/icons/phosphor. Keep this list the source of truth: the
 * Notifier reads defaults from here so callers only pass what varies.
 */
final class NotificationType
{
    /**
     * @var array<string, array{module:string, level:string, icon:string, priority:string, pref:string, action_label:?string}>
     */
    private const DEFINITIONS = [
        // ── Email ──────────────────────────────────────────────
        'email.received'           => ['module' => 'email', 'level' => Notification::LEVEL_INFO,     'icon' => 'EnvelopeSimple',  'priority' => 'normal', 'pref' => 'email',     'action_label' => 'Open email'],
        'email.reply'              => ['module' => 'email', 'level' => Notification::LEVEL_INFO,     'icon' => 'EnvelopeSimple',  'priority' => 'normal', 'pref' => 'email',     'action_label' => 'Open email'],
        'email.attachment'         => ['module' => 'email', 'level' => Notification::LEVEL_INFO,     'icon' => 'Paperclip',       'priority' => 'normal', 'pref' => 'email',     'action_label' => 'Open email'],
        'email.send_failed'        => ['module' => 'email', 'level' => Notification::LEVEL_ERROR,    'icon' => 'WarningCircle',   'priority' => 'high',   'pref' => 'email',     'action_label' => 'Retry'],
        'email.sync_failed'        => ['module' => 'email', 'level' => Notification::LEVEL_ERROR,    'icon' => 'WarningCircle',   'priority' => 'high',   'pref' => 'email',     'action_label' => 'Retry synchronization'],
        'email.shared_activity'    => ['module' => 'email', 'level' => Notification::LEVEL_INFO,     'icon' => 'EnvelopeSimple',  'priority' => 'normal', 'pref' => 'email',     'action_label' => 'Open email'],
        'email.connection_expired' => ['module' => 'email', 'level' => Notification::LEVEL_WARNING,  'icon' => 'PlugsConnected',  'priority' => 'high',   'pref' => 'security',  'action_label' => 'Reconnect'],
        'email.snooze_due'         => ['module' => 'email', 'level' => Notification::LEVEL_REMINDER, 'icon' => 'ClockCountdown',  'priority' => 'high',   'pref' => 'email',     'action_label' => 'Open email'],

        // ── Messages ───────────────────────────────────────────
        'message.received'      => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'ChatCircle',  'priority' => 'normal', 'pref' => 'messages', 'action_label' => 'View message'],
        'message.group'         => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'ChatsCircle', 'priority' => 'normal', 'pref' => 'groups',   'action_label' => 'View message'],
        'message.mention'       => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'At',          'priority' => 'high',   'pref' => 'messages', 'action_label' => 'View message'],
        'message.reply'         => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'ChatCircle',  'priority' => 'normal', 'pref' => 'messages', 'action_label' => 'View message'],
        'message.reaction'      => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'Smiley',      'priority' => 'low',    'pref' => 'messages', 'action_label' => 'View message'],
        'message.attachment'    => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'Paperclip',   'priority' => 'normal', 'pref' => 'messages', 'action_label' => 'View message'],
        'message.group_added'   => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'UsersThree',  'priority' => 'normal', 'pref' => 'groups',   'action_label' => 'View group'],
        'message.group_removed' => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'UsersThree',  'priority' => 'normal', 'pref' => 'groups',   'action_label' => null],
        'message.group_admin'   => ['module' => 'messages', 'level' => Notification::LEVEL_INFO, 'icon' => 'UserGear',    'priority' => 'normal', 'pref' => 'groups',   'action_label' => 'View group'],

        // ── Calendar ───────────────────────────────────────────
        'calendar.invitation'  => ['module' => 'calendar', 'level' => Notification::LEVEL_ACTION,   'icon' => 'CalendarPlus',  'priority' => 'high',   'pref' => 'calendar', 'action_label' => 'Respond'],
        'calendar.updated'     => ['module' => 'calendar', 'level' => Notification::LEVEL_INFO,     'icon' => 'CalendarBlank', 'priority' => 'normal', 'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.cancelled'   => ['module' => 'calendar', 'level' => Notification::LEVEL_WARNING,  'icon' => 'CalendarX',     'priority' => 'normal', 'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.reminder'    => ['module' => 'calendar', 'level' => Notification::LEVEL_REMINDER, 'icon' => 'Bell',          'priority' => 'high',   'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.response'    => ['module' => 'calendar', 'level' => Notification::LEVEL_INFO,     'icon' => 'CalendarCheck', 'priority' => 'low',    'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.shared'      => ['module' => 'calendar', 'level' => Notification::LEVEL_INFO,     'icon' => 'CalendarBlank', 'priority' => 'normal', 'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.group_added' => ['module' => 'calendar', 'level' => Notification::LEVEL_INFO,     'icon' => 'CalendarBlank', 'priority' => 'normal', 'pref' => 'calendar', 'action_label' => 'View event'],
        'calendar.sync_error'  => ['module' => 'calendar', 'level' => Notification::LEVEL_ERROR,    'icon' => 'WarningCircle', 'priority' => 'high',   'pref' => 'calendar', 'action_label' => 'Retry synchronization'],
        'calendar.conflict'    => ['module' => 'calendar', 'level' => Notification::LEVEL_WARNING,  'icon' => 'Warning',       'priority' => 'normal', 'pref' => 'calendar', 'action_label' => 'View event'],

        // ── Files & Folders ────────────────────────────────────
        'file.uploaded'         => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'FileArrowUp',           'priority' => 'normal', 'pref' => 'files', 'action_label' => 'View file'],
        'file.shared'           => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'ShareNetwork',          'priority' => 'normal', 'pref' => 'files', 'action_label' => 'View file'],
        'folder.shared'         => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'FolderNotch',           'priority' => 'normal', 'pref' => 'files', 'action_label' => 'Open folder'],
        'folder.assigned'       => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'FolderNotch',           'priority' => 'normal', 'pref' => 'files', 'action_label' => 'Open folder'],
        'file.updated'          => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'FilePlus',              'priority' => 'low',    'pref' => 'files', 'action_label' => 'View file'],
        'file.deleted'          => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'TrashSimple',           'priority' => 'low',    'pref' => 'files', 'action_label' => null],
        'file.restored'         => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'ArrowCounterClockwise', 'priority' => 'low',    'pref' => 'files', 'action_label' => 'View file'],
        'file.mention'          => ['module' => 'files', 'level' => Notification::LEVEL_INFO,    'icon' => 'At',                    'priority' => 'normal', 'pref' => 'files', 'action_label' => 'View file'],
        'file.upload_failed'    => ['module' => 'files', 'level' => Notification::LEVEL_ERROR,   'icon' => 'WarningCircle',         'priority' => 'high',   'pref' => 'files', 'action_label' => 'Retry'],
        'file.processing_done'  => ['module' => 'files', 'level' => Notification::LEVEL_SUCCESS, 'icon' => 'CheckCircle',           'priority' => 'low',    'pref' => 'files', 'action_label' => 'View file'],
        'file.signature_ready'  => ['module' => 'files', 'level' => Notification::LEVEL_ACTION,  'icon' => 'PenNib',                'priority' => 'high',   'pref' => 'files', 'action_label' => 'Sign document'],

        // ── Signatures ─────────────────────────────────────────
        'signature.requested' => ['module' => 'signatures', 'level' => Notification::LEVEL_ACTION,   'icon' => 'PenNib',        'priority' => 'high',   'pref' => 'signatures', 'action_label' => 'Sign document'],
        'signature.viewed'    => ['module' => 'signatures', 'level' => Notification::LEVEL_INFO,     'icon' => 'Eye',           'priority' => 'low',    'pref' => 'signatures', 'action_label' => 'View document'],
        'signature.signed'    => ['module' => 'signatures', 'level' => Notification::LEVEL_SUCCESS,  'icon' => 'CheckCircle',   'priority' => 'normal', 'pref' => 'signatures', 'action_label' => 'View document'],
        'signature.declined'  => ['module' => 'signatures', 'level' => Notification::LEVEL_WARNING,  'icon' => 'Xcircle',       'priority' => 'high',   'pref' => 'signatures', 'action_label' => 'View document'],
        'signature.expired'   => ['module' => 'signatures', 'level' => Notification::LEVEL_WARNING,  'icon' => 'ClockCountdown','priority' => 'normal', 'pref' => 'signatures', 'action_label' => 'View document'],
        'signature.completed' => ['module' => 'signatures', 'level' => Notification::LEVEL_SUCCESS,  'icon' => 'SealCheck',     'priority' => 'normal', 'pref' => 'signatures', 'action_label' => 'View document'],
        'signature.failed'    => ['module' => 'signatures', 'level' => Notification::LEVEL_ERROR,    'icon' => 'WarningCircle', 'priority' => 'high',   'pref' => 'signatures', 'action_label' => 'Retry'],
        'signature.reminder'  => ['module' => 'signatures', 'level' => Notification::LEVEL_REMINDER, 'icon' => 'Bell',          'priority' => 'normal', 'pref' => 'signatures', 'action_label' => 'Sign document'],

        // ── Clients ────────────────────────────────────────────
        'client.assigned'         => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'AddressBook', 'priority' => 'normal', 'pref' => 'clients', 'action_label' => 'Review client'],
        'client.created'          => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'UserPlus',    'priority' => 'normal', 'pref' => 'clients', 'action_label' => 'Review client'],
        'client.updated'          => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'AddressBook', 'priority' => 'low',    'pref' => 'clients', 'action_label' => 'Review client'],
        'client.status_changed'   => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'AddressBook', 'priority' => 'normal', 'pref' => 'clients', 'action_label' => 'Review client'],
        'client.document_added'   => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'FileDoc',     'priority' => 'normal', 'pref' => 'clients', 'action_label' => 'Review client'],
        'client.invitation'       => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'EnvelopeSimple','priority' => 'normal','pref' => 'clients', 'action_label' => null],
        'client.account_activity' => ['module' => 'clients', 'level' => Notification::LEVEL_INFO,     'icon' => 'AddressBook', 'priority' => 'low',    'pref' => 'clients', 'action_label' => 'Review client'],
        'client.approval_needed'  => ['module' => 'clients', 'level' => Notification::LEVEL_APPROVAL, 'icon' => 'SealQuestion','priority' => 'high',   'pref' => 'approvals','action_label' => 'Review client'],

        // ── Account & Security ─────────────────────────────────
        'account.pending'            => ['module' => 'account',  'level' => Notification::LEVEL_APPROVAL, 'icon' => 'UserCirclePlus', 'priority' => 'high',   'pref' => 'approvals', 'action_label' => 'Review Account'],
        'account.approved'           => ['module' => 'account',  'level' => Notification::LEVEL_SUCCESS,  'icon' => 'CheckCircle',    'priority' => 'normal', 'pref' => 'approvals', 'action_label' => null],
        'account.denied'             => ['module' => 'account',  'level' => Notification::LEVEL_ERROR,    'icon' => 'Xcircle',        'priority' => 'normal', 'pref' => 'approvals', 'action_label' => null],
        'security.password_changed'  => ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'Password',       'priority' => 'high',   'pref' => 'security',  'action_label' => 'Review security activity'],
        'security.new_login'         => ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'SignIn',         'priority' => 'normal', 'pref' => 'security',  'action_label' => 'Review security activity'],
        'security.suspicious_login'  => ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'ShieldWarning',  'priority' => 'urgent', 'pref' => 'security',  'action_label' => 'Review security activity'],
        'security.two_factor_changed'=> ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'ShieldCheck',    'priority' => 'high',   'pref' => 'security',  'action_label' => 'Review security activity'],
        'security.account_connected' => ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'PlugsConnected', 'priority' => 'normal', 'pref' => 'security',  'action_label' => 'Review security activity'],
        'security.connection_expired'=> ['module' => 'security', 'level' => Notification::LEVEL_WARNING,  'icon' => 'PlugsConnected', 'priority' => 'high',   'pref' => 'security',  'action_label' => 'Reconnect'],
        'security.permission_changed'=> ['module' => 'security', 'level' => Notification::LEVEL_SECURITY, 'icon' => 'Key',            'priority' => 'high',   'pref' => 'security',  'action_label' => 'Review security activity'],

        // ── System ─────────────────────────────────────────────
        'system.sync_completed'    => ['module' => 'system', 'level' => Notification::LEVEL_SUCCESS,  'icon' => 'ArrowsClockwise', 'priority' => 'low',    'pref' => 'system', 'action_label' => null],
        'system.upload_processed'  => ['module' => 'system', 'level' => Notification::LEVEL_SUCCESS,  'icon' => 'CheckCircle',     'priority' => 'low',    'pref' => 'system', 'action_label' => 'View file'],
        'system.storage_warning'   => ['module' => 'system', 'level' => Notification::LEVEL_WARNING,  'icon' => 'HardDrives',      'priority' => 'high',   'pref' => 'system', 'action_label' => null],
        'system.import_completed'  => ['module' => 'system', 'level' => Notification::LEVEL_SUCCESS,  'icon' => 'CheckCircle',     'priority' => 'low',    'pref' => 'system', 'action_label' => null],
        'system.reminder'          => ['module' => 'system', 'level' => Notification::LEVEL_REMINDER, 'icon' => 'Bell',            'priority' => 'normal', 'pref' => 'system', 'action_label' => null],
        'system.job_failed'        => ['module' => 'system', 'level' => Notification::LEVEL_ERROR,    'icon' => 'WarningCircle',   'priority' => 'high',   'pref' => 'system', 'action_label' => 'Retry'],
        'system.permission_updated'=> ['module' => 'system', 'level' => Notification::LEVEL_INFO,     'icon' => 'Key',             'priority' => 'normal', 'pref' => 'system', 'action_label' => null],
    ];

    /** A safe fallback for an unregistered type, so a caller typo never crashes a send. */
    private const FALLBACK = ['module' => 'system', 'level' => Notification::LEVEL_INFO, 'icon' => 'Notification', 'priority' => 'normal', 'pref' => 'system', 'action_label' => null];

    /**
     * The preference groups a user can toggle (§21). Security and approval
     * groups are listed but the Notifier refuses to let them silence the
     * portal delivery of security/approval alerts.
     */
    public const PREFERENCE_GROUPS = [
        'email', 'messages', 'calendar', 'files', 'signatures',
        'clients', 'groups', 'approvals', 'security', 'system',
    ];

    /** Groups whose portal notifications can never be fully switched off (§21). */
    public const NON_SILENCEABLE = ['security', 'approvals'];

    public static function has(string $type): bool
    {
        return isset(self::DEFINITIONS[$type]);
    }

    /**
     * @return array{module:string, level:string, icon:string, priority:string, pref:string, action_label:?string}
     */
    public static function definition(string $type): array
    {
        return self::DEFINITIONS[$type] ?? self::FALLBACK;
    }

    public static function module(string $type): string
    {
        return self::definition($type)['module'];
    }

    public static function level(string $type): string
    {
        return self::definition($type)['level'];
    }

    public static function icon(string $type): string
    {
        return self::definition($type)['icon'];
    }

    public static function priority(string $type): string
    {
        return self::definition($type)['priority'];
    }

    public static function preferenceGroup(string $type): string
    {
        return self::definition($type)['pref'];
    }

    public static function actionLabel(string $type): ?string
    {
        return self::definition($type)['action_label'];
    }

    /** All registered type keys (used by tests and the preferences UI). */
    public static function all(): array
    {
        return array_keys(self::DEFINITIONS);
    }
}
