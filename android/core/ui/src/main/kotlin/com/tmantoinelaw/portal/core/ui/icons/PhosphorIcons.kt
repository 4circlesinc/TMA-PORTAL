package com.tmantoinelaw.portal.core.ui.icons

import com.tmantoinelaw.portal.core.ui.R

/**
 * Phosphor icon names (as the API sends them in notifications and file records) to the
 * converted vector drawables. Regenerate the drawables with android/tools/svg2vector.py.
 */
object PhosphorIcons {
    private val byName: Map<String, Int> = mapOf(
        "AddressBook" to R.drawable.ic_address_book,
        "ArrowCounterClockwise" to R.drawable.ic_arrow_counter_clockwise,
        "ArrowLeft" to R.drawable.ic_arrow_left,
        "ArrowLineDown-16" to R.drawable.ic_arrow_line_down_16,
        "ArrowsClockwise" to R.drawable.ic_arrows_clockwise,
        "At" to R.drawable.ic_at,
        "Bell" to R.drawable.ic_bell,
        "Buildings" to R.drawable.ic_buildings,
        "CalendarBlank" to R.drawable.ic_calendar_blank,
        "CalendarCheck" to R.drawable.ic_calendar_check,
        "CalendarPlus" to R.drawable.ic_calendar_plus,
        "CalendarX" to R.drawable.ic_calendar_x,
        "ChartBar" to R.drawable.ic_chart_bar,
        "ChartPieSlice" to R.drawable.ic_chart_pie_slice,
        "ChatCircle" to R.drawable.ic_chat_circle,
        "ChatsCircle" to R.drawable.ic_chats_circle,
        "CheckCircle" to R.drawable.ic_check_circle,
        "Clipboard" to R.drawable.ic_clipboard,
        "ClockCountdown" to R.drawable.ic_clock_countdown,
        "ClockCounterClockwise" to R.drawable.ic_clock_counter_clockwise,
        "EnvelopeSimple" to R.drawable.ic_envelope_simple,
        "Eye" to R.drawable.ic_eye,
        "FileArrowUp" to R.drawable.ic_file_arrow_up,
        "FilePlus" to R.drawable.ic_file_plus,
        "FolderNotch" to R.drawable.ic_folder_notch,
        "GearSix" to R.drawable.ic_gear_six,
        "House" to R.drawable.ic_house,
        "ListDashes" to R.drawable.ic_list_dashes,
        "Newspaper" to R.drawable.ic_newspaper,
        "Paperclip" to R.drawable.ic_paperclip,
        "PenNib" to R.drawable.ic_pen_nib,
        "PhoneCall" to R.drawable.ic_phone_call,
        "PhoneX" to R.drawable.ic_phone_x,
        "PlugsConnected" to R.drawable.ic_plugs_connected,
        "Rightbar" to R.drawable.ic_rightbar,
        "SealCheck" to R.drawable.ic_seal_check,
        "Search-16" to R.drawable.ic_search_16,
        "ShareNetwork" to R.drawable.ic_share_network,
        "Sidebar" to R.drawable.ic_sidebar,
        "SignOut" to R.drawable.ic_sign_out,
        "Signature" to R.drawable.ic_signature,
        "Smiley" to R.drawable.ic_smiley,
        "SquaresFour" to R.drawable.ic_squares_four,
        "Sun" to R.drawable.ic_sun,
        "Table" to R.drawable.ic_table,
        "TrashSimple" to R.drawable.ic_trash_simple,
        "UserGear" to R.drawable.ic_user_gear,
        "UserList" to R.drawable.ic_user_list,
        "UserPlus" to R.drawable.ic_user_plus,
        "UsersThree" to R.drawable.ic_users_three,
        "Warning" to R.drawable.ic_warning,
        "WarningCircle" to R.drawable.ic_warning_circle,
        "Xcircle" to R.drawable.ic_xcircle,
    )

    private val byLower: Map<String, Int> = byName.mapKeys { it.key.lowercase() }

    /** The drawable for a Phosphor name (any case: the API sends both `XCircle` and `Xcircle`), else null. */
    fun resolve(name: String?): Int? = name?.let { byName[it] ?: byLower[it.lowercase()] }

    fun resolveOr(name: String?, fallback: Int): Int = resolve(name) ?: fallback
}
