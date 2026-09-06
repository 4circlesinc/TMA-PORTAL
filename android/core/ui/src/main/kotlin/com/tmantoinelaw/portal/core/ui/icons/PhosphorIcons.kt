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
        "ArrowFall" to R.drawable.ic_arrow_fall,
        "ArrowLeft" to R.drawable.ic_arrow_left,
        "ArrowLineDown-16" to R.drawable.ic_arrow_line_down_16,
        "ArrowRise" to R.drawable.ic_arrow_rise,
        "ArrowUpRight" to R.drawable.ic_arrow_up_right,
        "ArrowsClockwise" to R.drawable.ic_arrows_clockwise,
        "At" to R.drawable.ic_at,
        "Bell" to R.drawable.ic_bell,
        "Buildings" to R.drawable.ic_buildings,
        "CalendarBlank" to R.drawable.ic_calendar_blank,
        "CalendarCheck" to R.drawable.ic_calendar_check,
        "CalendarPlus" to R.drawable.ic_calendar_plus,
        "CalendarX" to R.drawable.ic_calendar_x,
        "CaretLeft" to R.drawable.ic_caret_left,
        "CaretRight" to R.drawable.ic_caret_right,
        "ChartBar" to R.drawable.ic_chart_bar,
        "ChartPieSlice" to R.drawable.ic_chart_pie_slice,
        "ChatCircle" to R.drawable.ic_chat_circle,
        "ChatText" to R.drawable.ic_chat_text,
        "ChatsCircle" to R.drawable.ic_chats_circle,
        "CheckCircle" to R.drawable.ic_check_circle,
        "Clipboard" to R.drawable.ic_clipboard,
        "ClockCountdown" to R.drawable.ic_clock_countdown,
        "ClockCounterClockwise" to R.drawable.ic_clock_counter_clockwise,
        "Envelope" to R.drawable.ic_envelope,
        "EnvelopeSimple" to R.drawable.ic_envelope_simple,
        "Eye" to R.drawable.ic_eye,
        "EyeSlash" to R.drawable.ic_eye_slash,
        "File" to R.drawable.ic_file,
        "FileArrowUp" to R.drawable.ic_file_arrow_up,
        "FileAudio" to R.drawable.ic_file_audio,
        "FileCode" to R.drawable.ic_file_code,
        "FilePdf" to R.drawable.ic_file_pdf,
        "FilePlus" to R.drawable.ic_file_plus,
        "FilePpt" to R.drawable.ic_file_ppt,
        "FileText" to R.drawable.ic_file_text,
        "FileVideo" to R.drawable.ic_file_video,
        "FileZip" to R.drawable.ic_file_zip,
        "Folder" to R.drawable.ic_folder,
        "FolderNotch" to R.drawable.ic_folder_notch,
        "FolderNotchOpen" to R.drawable.ic_folder_notch_open,
        "FolderOpen" to R.drawable.ic_folder_open,
        "FolderSimple" to R.drawable.ic_folder_simple,
        "GearSix" to R.drawable.ic_gear_six,
        "House" to R.drawable.ic_house,
        "ListDashes" to R.drawable.ic_list_dashes,
        "Newspaper" to R.drawable.ic_newspaper,
        "Paperclip" to R.drawable.ic_paperclip,
        "PenNib" to R.drawable.ic_pen_nib,
        "Phone" to R.drawable.ic_phone,
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
        "Star" to R.drawable.ic_star,
        "Sun" to R.drawable.ic_sun,
        "Table" to R.drawable.ic_table,
        "TrashSimple" to R.drawable.ic_trash_simple,
        "UploadSimple" to R.drawable.ic_upload_simple,
        "UserGear" to R.drawable.ic_user_gear,
        "UserList" to R.drawable.ic_user_list,
        "UserPlus" to R.drawable.ic_user_plus,
        "Users" to R.drawable.ic_users,
        "UsersThree" to R.drawable.ic_users_three,
        "VideoCamera" to R.drawable.ic_video_camera,
        "Warning" to R.drawable.ic_warning,
        "WarningCircle" to R.drawable.ic_warning_circle,
        "Xcircle" to R.drawable.ic_xcircle,
    )

    private val byLower: Map<String, Int> = byName.mapKeys { it.key.lowercase() }

    /** The drawable for a Phosphor name (any case: the API sends both `XCircle` and `Xcircle`), else null. */
    fun resolve(name: String?): Int? = name?.let { byName[it] ?: byLower[it.lowercase()] }

    fun resolveOr(name: String?, fallback: Int): Int = resolve(name) ?: fallback
}
