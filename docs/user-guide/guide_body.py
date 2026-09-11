"""User-guide body copy. Helpers are passed in from build_guide.py."""

from __future__ import annotations


def write_guide(doc, h):
    add_title = h.add_title
    add_h2 = h.add_h2
    add_body = h.add_body
    add_bullets = h.add_bullets
    add_table = h.add_table
    add_callout = h.add_callout
    add_image = h.add_image

    _intro(doc, add_title, add_h2, add_body, add_bullets, add_callout)
    _about(doc, add_title, add_h2, add_body, add_bullets)
    _getting_started(doc, add_title, add_h2, add_body, add_bullets)
    _signing_in(doc, add_title, add_h2, add_body, add_bullets, add_callout, add_image)
    _navigation(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _status(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _dashboard(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _overview_apps(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _cip_list(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _invite_providers(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _cip_pre(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout)
    _cip_post(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout)
    _cip_file(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _records(doc, add_title, add_h2, add_body, add_bullets, add_callout)
    _files(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _email(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _messages(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _feed(doc, add_title, add_h2, add_body, add_bullets, add_table, add_image)
    _calendar(doc, add_title, add_h2, add_body, add_bullets, add_table, add_image)
    _signatures(doc, add_title, add_h2, add_body, add_bullets, add_image)
    _workflows(doc, add_title, add_h2, add_body, add_table, add_image)
    _reporting(doc, add_title, add_h2, add_body, add_bullets, add_image)
    _calls(doc, add_title, add_h2, add_body, add_table, add_image)
    _users(doc, add_title, add_h2, add_body, add_image)
    _settings(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image)
    _roles(doc, add_title, add_h2, add_body, add_table, add_callout)
    _activity(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout)
    _common(doc, add_title, add_table)
    _trouble(doc, add_title, add_table)
    _faq(doc, add_title, add_h2, add_body)
    _support(doc, add_title, add_body, add_table)


def _intro(doc, add_title, add_h2, add_body, add_bullets, add_callout):
    doc.add_page_break()
    add_title(doc, "1. Introduction")
    add_body(
        doc,
        "The TM ANTOINE Advisory Portal is the firm’s workspace for Citizenship by Investment (CIP) files, documents, mail, messages, calendars, signatures, and the people connected to that work.",
    )
    add_body(
        doc,
        "Use this guide when you need to sign in, find a screen, complete a CIP application, share a file, or change an account setting. Keep it beside you the first time you use a feature, then return to the relevant section when a question comes up.",
    )
    add_h2(doc, "Who this guide is for")
    add_bullets(
        doc,
        [
            "Administrators who set up the firm, approve accounts, assign CIP files, and manage CIP Console settings.",
            "CRO / Reviewing officers — the working staff role. They review applications, documents, and decisions. In everyday speech people often call this “employees”; in the portal the working type is CRO / Reviewing officer, not Employee.",
            "Service-provider contacts and private clients who were invited to work on their own files.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Accounts still typed as Employee cannot use the portal. They see a holding screen until an administrator assigns CRO / Reviewing officer or Administrator. Client accounts are created by invitation, not from the Users page.",
    )


def _about(doc, add_title, add_h2, add_body, add_bullets):
    add_title(doc, "2. About the Portal")
    add_body(
        doc,
        "Open the portal in a web browser at https://portal.tmantoinelaw.com. After you sign in you work inside one shell: a sidebar on the left, a header across the top, the current page in the centre, and an optional Activity panel on the right.",
    )
    add_h2(doc, "What the portal is used for")
    add_bullets(
        doc,
        [
            "Create, review, and move CIP applications through pre-approval, post-approval, appeal, and closed work.",
            "Store and share the files that belong to those applications and to the firm, including connected OneDrive files.",
            "Message colleagues, place voice and video calls, share a screen, read connected email, and keep a calendar.",
            "Send and sign signature requests.",
            "Approve people to use the portal and control what each account can open.",
        ],
    )
    add_h2(doc, "What you will not find here")
    add_body(
        doc,
        "The portal does not put a Citizenship by Investment Smartsheet module in the main menu. If that module is turned off for the environment, it is not available to anyone, including administrators. This guide does not describe screens that are switched off.",
    )


def _getting_started(doc, add_title, add_h2, add_body, add_bullets):
    add_title(doc, "3. Getting Started")
    add_body(
        doc,
        "You need an approved account before you can use the portal. Most people arrive in one of two ways.",
    )
    add_h2(doc, "You were invited")
    add_body(
        doc,
        "Open the invitation email and follow the link. Complete the screens the portal shows you. Clients typically see Welcome, About you, How we reach you, an optional calendar connection, then Your account. Staff see a Set up your account checklist, then preferences, two-factor authentication, notifications, and (if you use portal mail) Email.",
    )
    add_h2(doc, "You already have an account")
    add_body(
        doc,
        "Go to the sign-in page and use Google, Microsoft, or Email, as described in the next section.",
    )
    add_h2(doc, "Before you start")
    add_bullets(
        doc,
        [
            "Use a current browser on a computer. A phone will open the portal, but tables and CIP intake are easier on a wide screen.",
            "Have access to the inbox for the email on your account. New devices ask for a six-digit email code.",
            "If your firm requires an authenticator app, have that app ready.",
            "Optional: install the Windows, macOS, or Android application from Overview. See section 8.",
        ],
    )


def _signing_in(doc, add_title, add_h2, add_body, add_bullets, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "4. Signing In")
    add_body(
        doc,
        "The sign-in page shows the TM ANTOINE mark and three ways to sign in. Choose the method your administrator expects you to use.",
    )
    add_image(
        doc,
        "02-login-options-annotated.png",
        "Figure 1. Sign in. 1 — Firm mark. 2 — Sign in with Google. 3 — Sign in with Microsoft. 4 — Sign in with Email.",
    )
    add_h2(doc, "Step 1 — Open the sign-in page")
    add_body(
        doc,
        "In your browser go to https://portal.tmantoinelaw.com. If you are not already signed in, the portal opens Sign in.",
    )
    add_h2(doc, "Step 2 — Choose a sign-in method")
    add_body(
        doc,
        "Click Sign in with Google or Sign in with Microsoft to use that account. The browser opens the provider’s sign-in page. Finish there, then you return to the portal.",
    )
    add_body(
        doc,
        "Click Sign in with Email to type your portal email and password.",
    )
    add_image(
        doc,
        "01-login-email.png",
        "Figure 2. Email sign-in. Enter Email and Password, then click Sign in. Use Forgot password? if you cannot remember the password. All sign in options returns to Google, Microsoft, and Email.",
    )
    add_h2(doc, "Step 3 — Enter email and password")
    add_bullets(
        doc,
        [
            "Enter the email address on your portal account.",
            "Enter your password. The eye icon shows or hides the password.",
            "Click Sign in.",
        ],
        numbered=True,
    )
    add_h2(doc, "New to the portal?")
    add_body(
        doc,
        "Click Create an account under the sign-in buttons if you were told to register yourself. Most client and provider accounts are created from an invitation instead.",
    )
    add_h2(doc, "Confirm it is you")
    add_body(
        doc,
        "When you sign in from a browser the portal has not seen before, it emails a six-digit code and shows Let’s confirm it’s you. The email address is partly hidden (for example ad•••@…). The code expires in 10 minutes.",
    )
    add_image(
        doc,
        "03-login-code.png",
        "Figure 3. Email confirmation code. Enter the six digits, leave Trust this browser checked if this is your usual computer, then click Confirm.",
    )
    add_bullets(
        doc,
        [
            "Open the message with the subject Your sign-in code.",
            "Type the six digits into the boxes. The cursor moves forward as you type.",
            "Leave Trust this browser for 7 days checked on a private computer so the next sign-in on this browser skips the code. Clear the box on a shared computer.",
            "Click Confirm.",
            "If the code does not arrive, wait for the countdown, then click Resend code.",
            "If it was not you, click Reset your password.",
        ],
        numbered=True,
    )
    add_callout(
        doc,
        "IMPORTANT",
        "Do not share the email code. If you did not try to sign in, reset your password and contact support.",
    )
    add_h2(doc, "Authenticator app")
    add_body(
        doc,
        "If your account uses an authenticator app, the portal asks for the six-digit code from that app (or a recovery code) instead of, or in addition to, other checks. Enter the code and click Verify. You turn this on later under Settings → Account Security → Two-factor authentication.",
    )
    add_h2(doc, "Stay signed in")
    add_body(
        doc,
        "The portal may ask Stay signed in? Click Yes on a private computer. Click Not this time on a shared computer.",
    )
    add_h2(doc, "Forgot password")
    add_body(
        doc,
        "On the email sign-in form, click Forgot password?. Enter your email and submit the form. The portal emails a reset link if that address has an account. For privacy, the success screen does not tell you whether the address exists. Open the email, choose a new password, then sign in with it.",
    )
    add_h2(doc, "If your account is waiting")
    add_body(
        doc,
        "Until an administrator approves you, the portal shows that your account is under review. After approval you can continue. Parked Employee accounts see that the portal is under development until a working role is assigned.",
    )


def _navigation(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "5. Portal Navigation")
    add_body(
        doc,
        "Once you are in, the same chrome stays on every page: sidebar, header, the page in the middle, and the right-hand Activity panel when it is open.",
    )
    add_image(
        doc,
        "04-dashboard-annotated.png",
        "Figure 4. Portal shell. 1 — Sidebar (Menu and Folders). 2 — Greeting and profile photo. 3 — Dashboard summary cards. 4 — Recent Files and other tiles.",
    )

    add_h2(doc, "How the left sidebar opens and closes")
    add_body(
        doc,
        "The left sidebar has two styles. You pick the one you want under Settings → Theme → Sidebar style. The choice is stored on your account and follows you to other browsers.",
    )
    add_table(
        doc,
        ["Style", "How it behaves"],
        [
            [
                "Standard Sidebar",
                "Sits beside the page with labels. Click the menu (hamburger) button in the header to expand or collapse it. On a narrow screen the same button opens it as a drawer.",
            ],
            [
                "Hover Overlay Sidebar",
                "Stays collapsed as icons. Hover the rail to open the labels over the page. Move away and it collapses again. This is the default.",
            ],
        ],
    )
    add_image(
        doc,
        "25-theme.png",
        "Figure 5. Settings → Theme. Light or Dark, font size, and Sidebar style (Standard Sidebar or Hover Overlay Sidebar).",
    )
    add_h2(doc, "Light mode and dark mode")
    add_body(
        doc,
        "Two places change appearance. The sun/moon button in the header toggles Light and Dark immediately. Settings → Theme does the same and also sets font size (five steps from small Aa to large Aa). Dark is a full dark theme, not a separate “night” product.",
    )

    add_h2(doc, "Sidebar — Menu")
    add_body(
        doc,
        "The Menu tab is the main list. Click a row to open that page. Rows with a chevron expand to show children.",
    )
    add_table(
        doc,
        ["Item", "What it opens"],
        [
            ["Dashboard", "Home: greeting, KPI cards, tiles, Recent Files, Default Folders."],
            ["Overview", "Staff overview, profile, desktop/mobile app downloads, Activity, Files, Recycle Bin."],
            ["CIP Applications", "Citizenship by Investment files at /citizenship-applications."],
            ["Email", "Connected mailbox. Staff with mail access."],
            ["Messages", "Conversations, voice and video calls, screen share."],
            ["Feed", "Internal posts and channels."],
            ["Calendar", "Your calendars and, for staff, shared calendars."],
            ["Signatures", "Signature requests. The page title is Signature Requests."],
            ["File Library", "All Files, Personal Folders, Shared Folders, Shared With Me, Favorites, Recent, File Box, Recycle Bin."],
            ["Users", "Account table. Administrators."],
            ["Reporting", "Firm reports. Administrators."],
            ["Templates", "System Emails, Email Templates, Granted And Denied Letters, Document Requirements."],
            ["Workflows", "Requests, Feedback And Comments, Updates Required."],
            ["Call Recordings", "Recorded client calls. Staff; employees see their own recordings."],
            ["People", "Directories, address books, distribution groups, resend welcome emails."],
            ["Settings", "Account settings rail."],
        ],
    )

    add_h2(doc, "Sidebar — Folders (Folder Shortcuts)")
    add_body(
        doc,
        "The Folders tab is not the full File Library. It is Folder Shortcuts: folders you pin for faster access. Switch between Main Menu and Folder Shortcuts with the Menu and Folders tabs at the top of the sidebar.",
    )
    add_h2(doc, "Pin a folder and colour-code it")
    add_body(
        doc,
        "In File Library, right-click a folder (or use the row menu) and choose from:",
    )
    add_table(
        doc,
        ["Command", "What it does"],
        [
            ["Add to Folder Shortcuts", "Pins the folder on the Folders tab of the main menu. The toast reads Added to Folder Shortcuts. Choose Remove from Folder Shortcuts to take it off."],
            ["Folder appearance", "Opens colour and icon for that folder so you can colour-code it in the tree and on shortcuts."],
            ["Make default folder", "Administrators only. Places the folder on the Dashboard Default Folders strip."],
        ],
    )

    add_h2(doc, "The right sidebar (faster access)")
    add_body(
        doc,
        "Click Toggle right panel in the header (the panel icon next to the bell). The panel is labelled Activity and has three sections you can use without leaving the page:",
    )
    add_table(
        doc,
        ["Section", "What it shows"],
        [
            ["Notifications", "Notices for you. Use See all notifications for the full list."],
            ["Activities", "Recent things that happened in the portal, including CIP status moves and file events. Use See all activities for the full log (Overview → Activity is the same idea)."],
            ["Clients", "People and files you can jump to quickly, such as CIP applicants on the hub."],
        ],
    )
    add_body(
        doc,
        "Close the panel with the same header button when you want the page full width.",
    )

    add_h2(doc, "Header")
    add_table(
        doc,
        ["Control", "What it does"],
        [
            ["Sidebar button", "Expands, collapses, or opens the left sidebar as a drawer."],
            ["Breadcrumb", "Shows where you are, for example Dashboard or File Library / All Files."],
            ["Search", "Opens portal search. The shortcut is the / key."],
            ["Presence (green/status dot)", "Shows and sets your status. See section 6."],
            ["Theme (sun/moon)", "Switches Light and Dark."],
            ["Bell", "Notifications. A badge shows unread items. The control is also labelled Activity in some layouts."],
            ["Right panel", "Opens or closes Notifications / Activities / Clients."],
        ],
    )
    add_h2(doc, "Profile and sign out")
    add_body(
        doc,
        "Your name, email, and photo sit at the bottom of the sidebar. Click the sign-out icon to end the session.",
    )
    add_h2(doc, "On a phone")
    add_body(
        doc,
        "A bottom bar offers Dashboard, CIP Applications, Email, Messages, and Profile. The mobile Home hub includes Search and the same main destinations.",
    )
    add_callout(
        doc,
        "TIP",
        "Press / to search. Search looks at the pages your account is allowed to open.",
    )


def _status(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "6. Your status")
    add_body(
        doc,
        "Colleagues see whether you are free, on a call, in the office, or away. Click the status control in the header (it may read Status: Online. Click to change.).",
    )
    add_image(
        doc,
        "15-status-picker.png",
        "Figure 6. Status menu. Online (Automatic) at the top, then Available, On a Call, At a Meeting, Do Not Disturb, In Office, Working Remote, Out of Office, and Status settings…",
    )
    add_h2(doc, "What each choice means")
    add_table(
        doc,
        ["Status", "Use it when"],
        [
            ["Online (Automatic)", "The portal sets this from your activity. You did not pick a manual status."],
            ["Available", "You are free to be contacted."],
            ["On a Call", "You are on a voice or video call. A live call can also set this for you."],
            ["At a Meeting", "You are in a meeting. You can give this a duration (30 minutes, 1 hour, 2 hours, Today, Indefinitely, or Custom…)."],
            ["Do Not Disturb", "You do not want to be interrupted. Also offered with a duration."],
            ["In Office", "You are working from the office. Automatic detection can set this when you are inside your office pin (see below)."],
            ["Working Remote", "You are working from your remote pin."],
            ["Out of Office", "You are away. Also offered with a duration."],
        ],
    )
    add_body(
        doc,
        "Optional: type a short line in Add a status message… so others see a note next to your status.",
    )
    add_h2(doc, "Automatic office / remote detection")
    add_body(
        doc,
        "Click Status settings… to open Presence settings. The Work locations tab lets the portal detect whether you are in the office or working remotely. The page says: Allow location access to automatically detect whether you're working from the office or remotely. Your exact location is never shown to others.",
    )
    add_image(
        doc,
        "16-status-settings.png",
        "Figure 7. Presence settings → Work locations. Office location (and further down, Remote location) with address search, map pin, detection radius, and Enable automatic detection.",
    )
    add_bullets(
        doc,
        [
            "For Office location and Remote location, enter a Label and Address, click Find on map, or Use current location.",
            "Click the map to drop a pin. The circle is the Detection radius (metres), from 25 to 5000, default 100.",
            "Tick Enable automatic detection when the pin is set.",
            "Click Save locations.",
            "Use Reset if you need to clear a pin.",
        ],
        numbered=True,
    )
    add_callout(
        doc,
        "NOTE",
        "The browser must be allowed to share location. A live call can override an office pin while you are on that call. Manual status still wins if you pick one yourself.",
    )
    add_h2(doc, "Scheduled statuses")
    add_body(
        doc,
        "On Presence settings, open Scheduled statuses. The hint reads: Schedule Away, meetings, or focus time with start and end dates.",
    )
    add_image(
        doc,
        "17-scheduled-status.png",
        "Figure 8. Add schedule. Status (Out of Office, At a Meeting, Do Not Disturb, or Focus Time), Starts, Ends, optional Message, then Add schedule.",
    )
    add_bullets(
        doc,
        [
            "Choose a Status: Out of Office, At a Meeting, Do Not Disturb, or Focus Time.",
            "Set Starts and Ends.",
            "Optional: type a Message (up to 140 characters).",
            "Click Add schedule. Remove a row later with the delete control on that schedule.",
        ],
        numbered=True,
    )
    add_body(
        doc,
        "The Dashboard Employees tile (staff only) shows who is online and today’s work status (office, remote, leave).",
    )


def _dashboard(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    add_title(doc, "7. Dashboard")
    add_body(
        doc,
        "Dashboard is the home page. It greets you by name and shows the KPI cards, then tiles, then Recent Files and Default Folders at the bottom. Staff see the KPI row. Clients do not.",
    )
    add_image(
        doc,
        "14-dashboard-kpis.png",
        "Figure 9. Dashboard top. Hello, This month, Edit Dashboard, then the four KPI cards, with Recent Files underneath.",
    )
    add_h2(doc, "KPI cards at the top (staff)")
    add_table(
        doc,
        ["Card", "Meaning"],
        [
            ["Avg. Response to Clients", "How quickly the firm has been answering clients in the selected period. Shows No replies yet when there is nothing to measure."],
            ["New CIP Applications", "New CIP files in the period. Click the card to open CIP Applications."],
            ["CIP Updates Required", "Files waiting on updates. All clear means none."],
            ["Awaiting Signature", "Signature requests still unsigned. All signed means none."],
        ],
    )
    add_body(
        doc,
        "Service-provider contacts with CIP access see a different row: Active CIP Applications, CIP Updates Required, Unread Messages, and Open Comments.",
    )
    add_h2(doc, "Date range")
    add_body(
        doc,
        "Use This month (or Today, This week, This year) in the page header to change the period the cards use.",
    )
    add_h2(doc, "Hide or show the workflow strip")
    add_body(
        doc,
        "Next to Edit Dashboard the greeting can show Hide workflows or Show workflows. That only hides the workflow strip on the home page. It does not delete Workflows from the sidebar.",
    )
    add_h2(doc, "Edit Dashboard — choose which tiles you see")
    add_body(
        doc,
        "Click Edit Dashboard (the grid icon). The dialog title is Edit Dashboard. The line under it reads: Choose which tiles to show on your dashboard. Turn a switch off for any tile you do not want. Turn it on to bring the tile back. A tile that needs a permission you do not hold is not offered.",
    )
    add_image(
        doc,
        "18-edit-dashboard.png",
        "Figure 10. Edit Dashboard. Each tile has a short description and a switch.",
    )
    add_table(
        doc,
        ["Tile", "What it shows"],
        [
            ["Recent Files", "Files you last accessed across all of your devices."],
            ["Recent Email", "Your latest inbox messages, ready to open. Needs mail access."],
            ["Messages", "Your five most recent chats, with unread counts."],
            ["Shortcuts", "Frequently used actions, as well as quick access to certain folders. Typical shortcuts: Email, Messages, Feed, Calendar, Users, Share Files, Request Files, Create New User, Shared Folders, Favorites, Feedback And Comments, Updates Required, Send for Signature."],
            ["Employees", "Who is online, and today's work status (office, remote, leave). Staff only."],
            ["Favorites", "Files and folders you marked as favorite."],
            ["Upcoming Events", "Upcoming events for the selected day."],
            ["CIP Applications", "Pre-approval and post-approval counts by stage, switched from the card."],
            ["Requests", "Reviews, approvals and signatures waiting on you."],
            ["Comments", "Recent discussion on files. Administrators see every thread; everyone else sees what involves them."],
        ],
    )
    add_h2(doc, "Recent Files (bottom of the dashboard)")
    add_body(
        doc,
        "Scroll below the tiles. Recent Files lists folders and files you opened recently, including CIP application folders (for example Citizenship Applications Portal / Chen Wei / Main Applicant). Click a row to open it in File Library. Tabs on the strip typically include Recent Files and Shared With Me. Type filters (PDF, Word, Excel, and others) narrow the list. This is the same recent set the File Library Recent view uses, kept in sync across your devices.",
    )
    add_h2(doc, "Default Folders")
    add_body(
        doc,
        "Under that strip, Default Folders shows the folders an administrator marked for the firm (right-click a top-level folder in File Library → Make default folder). Clients do not see Default Folders. Click a default folder to open it.",
    )
    add_h2(doc, "Change your profile picture")
    add_body(
        doc,
        "If the greeting offers Change profile picture, click it and follow the prompt, or open Settings and edit My Profile.",
    )
    add_callout(
        doc,
        "TIP",
        "If a CIP file’s folders appear in Recent Files, opening them from the dashboard is the fastest way back into that application’s documents.",
    )


def _overview_apps(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "8. Overview and desktop apps")
    add_body(
        doc,
        "Overview is a staff page. Open it from the sidebar. Tabs typically include Overview, Employees, Users, Files, Notifications, Activity, and Recycle. The Overview tab shows your profile and the desktop/mobile app promo.",
    )
    add_image(
        doc,
        "19-overview-apps.png",
        "Figure 11. Overview. Profile Details, then Have you tried new macOS / Windows / Android Application? with macOS, Windows, and Android 8+.",
    )
    add_h2(doc, "Download the Windows application")
    add_body(
        doc,
        "The Windows build is for Windows 10 or later. On Overview click Windows. The file downloads in your browser.",
    )
    add_body(
        doc,
        "Microsoft Edge and Google Chrome often warn that the file is not commonly downloaded, or that this type of file can harm your computer (wording varies; some people see “not verified”). That is the browser protecting you from an uncommon installer, not a broken download.",
    )
    add_bullets(
        doc,
        [
            "On the download bar or the warning, click Keep.",
            "If the browser asks again, click Keep anyway (sometimes Keep always / Keep anyway depending on the browser version).",
            "Open the downloaded installer from your Downloads folder.",
            "Windows may then show Windows protected your PC (SmartScreen). Click More info, then Run anyway. The in-app hint for this step is: Windows warns on first launch, choose More info, then Run anyway.",
            "Finish like any other Windows application: Next / Install / Finish (or the equivalent buttons the installer shows). Sign in with the same account you use in the browser.",
        ],
        numbered=True,
    )
    add_h2(doc, "Download the macOS application")
    add_bullets(
        doc,
        [
            "On Overview click macOS and wait for the download.",
            "Open the downloaded file and move the app to Applications if the installer asks you to.",
            "The first launch is often blocked because the app is not signed the way the Mac Store is. Open System Settings → Privacy & Security.",
            "Find the message that the app was blocked, then allow it (Open Anyway / Allow, depending on your macOS version). The in-app hint is: macOS blocks the first launch, allow it in System Settings → Privacy & Security.",
            "Open the app again and sign in.",
        ],
        numbered=True,
    )
    add_h2(doc, "Download the Android application")
    add_body(
        doc,
        "The button is Android 8+ (Android 8 or later). On a computer, click it to open Get the Android app with a QR code. Scan with your phone's camera. The download starts on its own. If you are already on an Android phone, the same control can open the download page directly.",
    )
    add_callout(
        doc,
        "NOTE",
        "If a button is greyed out, no build has been published yet for that platform. Ask an administrator. Do not install copies from anywhere except Overview or the QR the portal shows.",
    )
    add_h2(doc, "Activity on Overview")
    add_body(
        doc,
        "Overview → Activity is the full activity log. The right-hand Activities list is a short version of the same stream. CIP status changes appear here as they happen (for example an application number “moved to Review Applications”). See section 27.",
    )


def _cip_list(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "9. CIP Applications")
    add_body(
        doc,
        "CIP Applications is the Citizenship by Investment file list. Open it from the sidebar. The address is /citizenship-applications.",
    )
    add_h2(doc, "Who uses it")
    add_table(
        doc,
        ["Who", "What they can do"],
        [
            ["Administrator", "See the full hub, assign officers, open Manage, configure CIP Console, move files through every mapped step, and override status when a file must be pulled backwards."],
            ["CRO / Reviewing officer", "Open CIP, create applications, review documents, update status along the mapped next steps, and record decisions they are allowed to. They cannot assign officers. They see the full status list, but off-map statuses are locked."],
            ["Service-provider contact", "Work on the provider’s files. The Service providers and Provider contacts registry tabs are hidden. They cannot drive status except lodging New Appeal when that is allowed."],
            ["Private client", "See their own files only. List tabs are hidden."],
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "CIP is a product module. If it is switched off for the environment, nobody — including administrators — can use it.",
    )
    add_h2(doc, "The application list")
    add_image(
        doc,
        "05-cip-applications-annotated.png",
        "Figure 12. CIP Applications. 1 — List tabs. 2 — Count, Status, Assigned to, Service provider filters, and Search. 3 — Application table.",
    )
    add_body(doc, "Staff tabs:")
    add_bullets(
        doc,
        [
            "All Applications",
            "Pre-Approval Applications",
            "Post-Approval Applications",
            "Appeals",
            "Closed",
            "Service providers (sometimes shortened to Providers)",
            "Provider contacts (sometimes shortened to Contacts)",
        ],
    )
    add_table(
        doc,
        ["Column", "Meaning"],
        [
            ["Application", "Internal number, for example GAL26-00003. Click the row to open the file."],
            ["Applicant", "Main applicant name."],
            ["Service provider", "The provider on the file."],
            ["Investment", "Investment type recorded on the file."],
            ["Family", "Family composition. Post-approval rows can expand members with their own status chips."],
            ["Status", "Where the file sits. Click Change status to move it when you are allowed to."],
            ["Assigned to", "Officer on the file. Use Assign an officer when you can assign (administrators)."],
        ],
    )
    add_h2(doc, "The Manage dropdown (administrators)")
    add_body(
        doc,
        "On the CIP list toolbar, click Manage (aria label: Manage CIP Applications). This menu is hidden from external CIP users. Each item opens the matching CIP Console page in Settings.",
    )
    add_image(
        doc,
        "31-cip-manage.png",
        "Figure 13. Manage: Manage access, Manage service teams, Manage custom fields, Manage documents, Manage decision letters, Manage distribution group.",
    )
    add_table(
        doc,
        ["Menu item", "What it opens"],
        [
            ["Manage access", "CIP Console → Access. Who on staff may use the client hub."],
            ["Manage service teams", "CIP Console → Service Teams."],
            ["Manage custom fields", "CIP Console → Custom Fields. Extra fields on records."],
            ["Manage documents", "CIP Console → Document Requirements (also under Templates)."],
            ["Manage decision letters", "CIP Console → Granted And Denied Letters."],
            ["Manage distribution group", "CIP Console → Distribution Group."],
        ],
    )
    add_h2(doc, "Create an application")
    add_body(
        doc,
        "Staff: click Create New Application. The menu offers Create New Pre-Approval Application, Create New Post-Approval Application, New service provider, and Import. Service-provider contacts see one button: Create New Application (pre-approval only). How to register a provider and invite its people to sign in is in section 10.",
    )
    add_h2(doc, "Fill the intake form")
    add_image(
        doc,
        "07-cip-intake.png",
        "Figure 14. New pre-approval application. Required fields are marked with a red asterisk. The form autosaves.",
    )
    add_table(
        doc,
        ["Field", "What to enter"],
        [
            ["Service provider", "Select the provider. Required."],
            ["Investment type", "Select the investment. If you choose other, specify it."],
            ["Sponsored", "Yes or No. If Yes, complete the sponsor fields."],
            ["Passport photo", "Square image, 2×2 inches, 600×600 pixels or larger."],
            ["First name / Last name", "Main applicant."],
            ["Gender / Date of birth", "As on the passport."],
            ["Country of birth / residence", "Select from the lists."],
            ["Occupation", "Applicant’s occupation."],
            ["Passport number", "As on the passport."],
            ["Passport bio page / Birth certificate", "Upload where the form requires them."],
        ],
    )
    add_body(
        doc,
        "Add dependents if needed. Each dependent needs at least first name, last name, date of birth, and relationship (Spouse or Qualified dependent). Post-approval intake also asks for the CIP application number from the decision letter.",
    )
    add_h2(doc, "How draft auto-save works")
    add_body(
        doc,
        "While you type a new application (or reopen a file that is still Draft), the form saves itself about 1.2 seconds after you stop typing. You will see Draft saved a moment ago under the form, and a toast Draft saved. There is also a Save as draft button if you want to save immediately.",
    )
    add_body(
        doc,
        "Autosave only runs on new filings and Draft rows. A filed application is not silently overwritten if you leave a form open. If you return and a draft is waiting, the portal offers to keep it (Keep it) or Start over.",
    )
    add_h2(doc, "Save as draft versus Add")
    add_bullets(
        doc,
        [
            "Click Save as draft to keep the file in Draft. Drafts appear in the table with a number. Draft is not a queue you pick in the status list. The way out of Draft is to file the application.",
            "When the required fields and files are complete, use Add in the page toolbar. The file joins New Applications. Filing checks the main applicant’s documents first.",
        ],
        numbered=True,
    )
    add_callout(
        doc,
        "IMPORTANT",
        "If something required is missing, the portal will not move the file into New Applications until you add it.",
    )


def _invite_providers(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    add_title(doc, "10. Inviting service providers")
    add_body(
        doc,
        "A service provider is a firm you work with on CIP files. Registering the firm and inviting its people are two steps. Do not add them on Users — invited provider people always arrive as Client accounts linked to that firm.",
    )
    add_h2(doc, "Who can do this")
    add_table(
        doc,
        ["Action", "Who"],
        [
            ["New service provider (register the firm)", "Staff with client-hub manage access: administrators and CRO / Reviewing officers. External CIP users do not see this menu item."],
            ["Invite from the provider’s Access card (email + Add)", "Administrators only. A CRO can open the provider but does not get that Add field."],
            ["Invite to portal on a contact’s profile", "Staff who can invite clients (administrators and CRO / Reviewing officers)."],
        ],
    )
    add_h2(doc, "Step 1 — Register the service provider")
    add_bullets(
        doc,
        [
            "Open CIP Applications.",
            "Click Create New Application.",
            "Click New service provider. (You can also open the Providers tab and create from there when the list is in use.)",
        ],
        numbered=True,
    )
    add_image(
        doc,
        "32-create-menu.png",
        "Figure 15. Create New Application menu. New service provider sits under the two application choices, with Import.",
    )
    add_body(
        doc,
        "The page title is New service provider (breadcrumb: CIP Applications / New service provider).",
    )
    add_image(
        doc,
        "33-new-provider.png",
        "Figure 16. New service provider. Enter Service provider name, optional Website, CIP code, and Notes, then Create.",
    )
    add_bullets(
        doc,
        [
            "Enter Service provider name. This is required.",
            "Optional: Website (placeholder https://).",
            "CIP code fills in from the name as you type (placeholder From the name). You can still edit it. The portal checks the code on the server so you do not reuse one another provider already owns.",
            "Optional: Notes about this company.",
            "Click Create. Click Cancel to leave without saving.",
        ],
        numbered=True,
    )
    add_h2(doc, "Step 2 — Open the provider")
    add_body(
        doc,
        "After Create, you land on that provider’s profile. Later, open CIP Applications → Providers (full label: Service providers) and click the firm’s name. If the tab says No service providers, register one first (step 1). The profile toolbar has Edit, Add person, and Delete. Cards include Details, Clients referred, Access, Provider contacts, and Assigned staff.",
    )
    add_h2(doc, "Step 3 — Invite people so they can sign in (administrators)")
    add_body(
        doc,
        "On the provider profile, find the Access card. This is who at the firm may use the portal for that provider’s files. Administrators see an Email address field and Add.",
    )
    add_bullets(
        doc,
        [
            "Type the person’s work email.",
            "Click Add. The portal adds them as a Service provider member and sends the invitation in the same action. A toast reads Invitation sent (or Member added if they already had an account and no mail went out).",
            "If you leave the email blank, the toast reads Enter an email address.",
            "If they already have access, the row shows Has access. If mail went out, Invite sent. If it failed, Invite failed. If nobody has been invited yet, the card can show No portal access yet.",
        ],
        numbered=True,
    )
    add_body(
        doc,
        "On a row that does not yet have an account, click Invite (or Resend if an invite was already sent or failed). The toast again reads Invitation sent. Remove a person’s company access with the trash control (confirm: Remove this person’s access to the company?).",
    )
    add_callout(
        doc,
        "NOTE",
        "Add on Access always tries to invite (it is not a silent “park the email”). Everyone is added as Service provider member. You can change the row’s role afterwards if they are actually the Primary contact, Finance contact, Event contact, Contract signatory, or Viewer.",
    )
    add_h2(doc, "Another way — invite a provider contact")
    add_body(
        doc,
        "Add person on the provider toolbar opens a contact form (a person at the firm, listed under Provider contacts). After they have an email, open that contact. If they cannot sign in yet, the toolbar shows Invite to portal (or Resend invite if one is already pending). The Portal access tab on the contact says No portal access yet. Invite them to create an account. — or Add an email address to this client before inviting them. After you invite, the same tab shows status such as Invitation sent, Invitation delivered, Invitation opened, Invitation accepted, Invitation expired, Invitation withdrawn, or Invitation could not be sent. You can Resend or Try again, Copy link, or Cancel while the invite can still be changed.",
    )
    add_h2(doc, "What the service provider receives")
    add_body(
        doc,
        "They get an email whose subject is of the form You’re invited to join {company} on {site}. The message says who invited them and that they are joining as their company role. They open the link, complete the client welcome screens (Welcome, About you, How we reach you, and so on), and sign in as a Client. They then see that provider’s CIP files — not the Users page, not CIP Console, not other firms’ files.",
    )
    add_body(
        doc,
        "Invitations expire after the number of days set for the firm (the default is 7 days). If it expires, send Resend / Try again. If they already had a portal account, they receive the existing-account variant of the same invite and are linked to the company when they accept.",
    )
    add_h2(doc, "What not to do")
    add_bullets(
        doc,
        [
            "Do not create a Users row and type them as Client. The Users page does not hand out Client.",
            "Do not skip registering the firm if you only invite a private email — they will not be a service-provider contact on the hub.",
            "A CIP application that shows a provider name (for example Galaxy Partners) is not the same as a registered provider record. Until you Create the firm under New service provider, the Providers tab can still read No service providers, and there is no Access card to invite from.",
        ],
    )
    add_callout(
        doc,
        "TIP",
        "Activities records that you invited the email to the company. After they accept, Portal access on their contact reads that they have a portal account and can sign in.",
    )


def _cip_pre(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout):
    add_title(doc, "11. Pre-Approval workflow")
    add_body(
        doc,
        "Pre-approval is the path from a new filing to the Unit’s decision (Approved or Denied). Work the file in this order unless an administrator overrides. Only administrators and CRO / Reviewing officers drive these steps. Service-provider contacts and private clients do not change status here (except later lodging an appeal).",
    )
    add_h2(doc, "Order of statuses")
    add_table(
        doc,
        ["Step", "Status / who / what happens"],
        [
            [
                "0. Draft",
                "Intake still being typed. Autosave. Not in status pickers. Staff or a provider files it with Add. Capability to enter New Applications: create.",
            ],
            [
                "1. New Applications",
                "Just filed. An administrator assigns a reviewing officer (Assign an officer). Moving into Review Applications needs assign, so officers wait for that assignment in the usual process.",
            ],
            [
                "2. Review Applications",
                "The officer reviews the file and documents. Next mapped step is Assessment Feedback (review).",
            ],
            [
                "3. Assessment Feedback",
                "Feedback is recorded. From here the file either goes to Updates Required (the provider/client must send more) or Ready to Submit (the package is complete).",
            ],
            [
                "4. Updates Required",
                "The provider side has work to do. When the update is back, staff can return the file to Assessment Feedback. (This same status is reused in post-approval when more paper is needed.)",
            ],
            [
                "5. Ready to Submit",
                "Ready to go forward. Next: Pending Review, or back to Updates Required if something is still missing.",
            ],
            [
                "6. Pending Review",
                "Waiting on review / compliance. Next: Non-compliant or Background Check (compliance).",
            ],
            [
                "7. Non-compliant",
                "Did not meet a requirement. Can return to Pending Review or move to Background Check.",
            ],
            [
                "8. Background Check",
                "Checks in progress. From here: Non-compliant, Delayed, Approved, or Denied.",
            ],
            [
                "9. Delayed",
                "Held up. From here: Non-compliant, Approved, or Denied.",
            ],
            [
                "10. Approved",
                "Pre-approval grant (chip: Approved). Record decision uses Granted letter templates. Next: Post-Approval, or New Appeal if the grant is disputed.",
            ],
            [
                "Denied",
                "Refused. Record decision uses Denied letter templates. Next: New Appeal if someone lodges an appeal.",
            ],
        ],
        col_twips=[1800, 8640],
    )
    add_h2(doc, "What a CRO does on this path")
    add_bullets(
        doc,
        [
            "Open the file, work Documents, leave comments, request updates.",
            "Use Change status for the next mapped step they are allowed to drive (review, compliance, decide).",
            "They see statuses that only an administrator may pick, shown as locked. They cannot pull a file backwards.",
            "They cannot assign the officer. If Assign an officer is missing, ask an administrator.",
        ],
    )
    add_h2(doc, "What an administrator does extra")
    add_bullets(
        doc,
        [
            "Assign the file.",
            "Override status when the mapped path is wrong (for example pull Approved back to Assessment Feedback).",
            "Configure letters, document requirements, access, and teams from Manage.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Dashboard CIP Applications tile counts these stages. CRO dashboards emphasise assigned reviews, pending reviews, assessment feedback tasks, and additional information requests. Administrators see the full pre-approval set of buckets.",
    )


def _cip_post(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout):
    add_title(doc, "12. Post-Approval workflow")
    add_body(
        doc,
        "Post-approval starts after a pre-approval grant. Staff enter it by moving the file to Post-Approval (or by filing Create New Post-Approval Application when the grant already exists outside this intake). The lane’s own decision (Approved or Denied on the post-approval letters) comes first, then COR, NIC, and passport dates.",
    )
    add_h2(doc, "How the file is given to a service provider")
    add_body(
        doc,
        "A service provider is not assigned the way an officer is. There is no Assign to service provider on an open file. The firm is chosen when the application is created, on the intake form field Service provider. That choice also prefixes the internal number (for example GAL26-00001), so it is not changed later.",
    )
    add_bullets(
        doc,
        [
            "File already in this portal and Approved (pre-approval grant): open the file and move it to Post-Approval. It stays with the same service provider that was selected at original filing. Invite that firm’s people (section 10) if they should see the file in the portal.",
            "Grant already exists outside this intake: CIP Applications → Create New Application → Create New Post-Approval Application → on Investment, select Service provider → complete the form → Add. That is how a new post-approval file is placed under a firm.",
            "Assign an officer (administrators) is who on staff reviews the file. It does not change the service provider.",
            "Users → assign a person to a service provider makes that account a contact of the firm. It does not move a CIP file.",
        ],
    )
    add_h2(doc, "Order after a grant")
    add_table(
        doc,
        ["Step", "What you do"],
        [
            [
                "1. Post-Approval",
                "The file has entered the lane. From here staff may send it to Updates Required, or record the post-approval outcome: Approved (post) or Denied (post).",
            ],
            [
                "2. Post-approval Approved",
                "Chip still reads Approved, but it is the post-approval outcome, not the original grant. Next typical step: Apply for COR. Updates Required is still available if more is needed.",
            ],
            [
                "3. Apply for COR",
                "Certificate of Residence. Do not use a bare status chip for the date. Click Record COR submission, enter COR submission date. The file moves to Pending COR.",
            ],
            [
                "4. Pending COR",
                "Waiting for the COR. Click Record COR received (COR received date). The file moves to Apply for NIC.",
            ],
            [
                "5. Apply for NIC",
                "National ID card. Click Record NIC submission → Pending NIC.",
            ],
            [
                "6. Pending NIC",
                "Click Record NIC received → Apply for Passport.",
            ],
            [
                "7. Apply for Passport",
                "Click Record passport application → Pending Passport. Updates Required is available if the file must wait on the provider.",
            ],
            [
                "8. Pending Passport",
                "Click Record passport received → Ready for Delivery.",
            ],
            [
                "9. Ready for Delivery",
                "Click Record passport delivered → Closed.",
            ],
            [
                "Closed",
                "Finished. Post-approval Denied can also close, or go to New Appeal.",
            ],
        ],
        col_twips=[2700, 7740],
    )
    add_h2(doc, "Date buttons (do not skip these)")
    add_body(
        doc,
        "Pending COR, Apply for NIC, and the later stage statuses are tied to a date. The generic status picker will not set them with an empty date. Use the Record … buttons so the day and the status travel together.",
    )
    add_h2(doc, "Appeals (either phase)")
    add_body(
        doc,
        "A decision is not always the end. From Approved (grant), Denied, or a post-approval denial, New Appeal can be lodged. The provider side may lodge New Appeal on a decided file that is theirs — that is the one status an external account may drive. After that, Appeal Ready and Appeal Submitted are the firm’s. Appeal Submitted ends in Approved or Denied (the same chips as the first decision, not a separate won/lost pair).",
    )
    add_callout(
        doc,
        "NOTE",
        "Updates Required in post-approval means the same thing as in pre-approval: the provider side has work to do. It is not a different queue with a different name.",
    )


def _cip_file(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    add_title(doc, "13. Working a CIP file")
    add_body(
        doc,
        "Click an application number or applicant to open the file. Typical tabs: Client info (or Overview with timeline and facts), Documents, Assigned, Messages, Portal access, and Activity. A pencil Edit control and a Message control sit in the header.",
    )
    add_image(
        doc,
        "29-cip-file.png",
        "Figure 17. Application profile. Folder, Edit, and Message in the header. Tabs: Client info, Documents, Assigned, Messages, Portal access.",
    )
    add_h2(doc, "Message the service provider")
    add_body(
        doc,
        "Click Message. The menu offers Message {provider} about {applicant}, or Message the service provider about {applicant}. If the applicant is not linked to a provider, the menu says so (for example This applicant isn’t linked to a service provider.). You may also see Message {person} privately. The Messages tab empty copy reads: No conversations on this file yet. Use Message to start one with the service provider. Comment threads on the file can be internal or provider. Workflow dialogs (query, appeal, accept) also include Message to the service provider.",
    )
    add_image(
        doc,
        "30-cip-message.png",
        "Figure 18. Message menu on a file.",
    )
    add_h2(doc, "Edit the form — administrator versus CRO")
    add_body(
        doc,
        "Click Edit to open Edit application. Person fields include First name, Last name, Date of birth, Passport number, Country of birth, Country of residence, Occupation. Click Save.",
    )
    add_table(
        doc,
        ["Who clicks Save", "What happens"],
        [
            ["Administrator", "The change is written immediately."],
            ["CRO / Reviewing officer, other staff who can reach the file, or a service-provider contact", "Save creates a change request. The file shows that the person asked to change those details. Waiting on an administrator. Only an administrator can approve or decline."],
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "There is one Save control, not a separate “Request changes” button on this screen. For a CRO, Save is the request.",
    )
    add_h2(doc, "How this syncs with Activities")
    add_body(
        doc,
        "Every status change writes an event on the file and a portal activity row. The description is typically the application number moved to the new status (or pulled from one status to another when an administrator overrides). That row appears in the file’s Activity tab, in the right-hand Activities list, and in Overview → Activity. Notifications also fan out on status changes. Opening Recent Files on the dashboard still lists the CIP folders you touched, so the file, the activity stream, and recent documents stay aligned.",
    )
    add_h2(doc, "Documents, assignment, portal access")
    add_bullets(
        doc,
        [
            "Documents — upload, review, comment, request updates.",
            "Assigned — who the officer is. Administrators assign.",
            "Portal access — who on the client/provider side can open the file.",
            "Open folder — jumps to the application’s File Library folder (the same folders that show under Recent Files).",
        ],
    )


def _records(doc, add_title, add_h2, add_body, add_bullets, add_callout):
    add_title(doc, "14. Managing Records")
    add_body(
        doc,
        "Lists in the portal follow the same pattern: a table, a search box, optional filters, sortable headings, and a row menu.",
    )
    add_h2(doc, "Search, filter, sort")
    add_body(
        doc,
        "Type in Search. Open a filter such as Status or Assigned to. Click a column heading to sort; click again to reverse. On CIP Applications, combine Search with Status and Assigned to instead of scrolling the full list.",
    )
    add_h2(doc, "Open, edit, add, remove")
    add_bullets(
        doc,
        [
            "Open a record by clicking its name or number.",
            "Add with the page action (Create New Application, the + on Users, or New message).",
            "Edit from the record, from More actions, or from Edit.",
            "Delete only where the portal offers it. File Library items can go to Recycle Bin. Account deletion is an administrator action on Users, or Delete my account on your own profile.",
        ],
    )


def _files(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "15. File Library")
    add_body(
        doc,
        "File Library holds the firm’s documents. Expand it in the sidebar and choose a view.",
    )
    add_image(
        doc,
        "10-file-library.png",
        "Figure 19. File Library / All Files. Toolbar: new folder, upload, extra folder actions, download, list or grid, sort, refresh, Name sort, and type filters. Star a folder to keep it in Favorites.",
    )
    add_table(
        doc,
        ["View", "What it shows"],
        [
            ["All Files", "The organisation tree you are allowed to see (staff). CIP-reach accounts may see a Clients-scoped tree."],
            ["Personal Folders", "Your personal area on the portal."],
            ["Shared Folders", "Folders shared across the firm. Staff."],
            ["Shared With Me", "Items other people shared with you."],
            ["Favorites", "Items you starred."],
            ["Recent", "Recently opened items — the same idea as Dashboard Recent Files."],
            ["File Box", "File Box items."],
            ["Recycle Bin", "Items you (or, for administrators, the firm) can restore or remove."],
        ],
    )
    add_h2(doc, "OneDrive")
    add_body(
        doc,
        "There is no separate “Personal OneDrive” row in the main menu. Connect Microsoft once under Settings → Connectors. OneDrive is described as Your OneDrive files in the file library. Outlook, Calendar and OneDrive link together. After it is connected, the library can pull OneDrive files (the portal refreshes that connection on a short interval). You can pause or resume sync; toasts read OneDrive sync paused or OneDrive sync resumed. Background Operations (administrators) is where to look if a OneDrive job has stopped.",
    )
    add_h2(doc, "Colour-code, pin, make default")
    add_bullets(
        doc,
        [
            "Folder appearance — colour and icon.",
            "Add to Folder Shortcuts — pin it on the Folders tab of the main menu.",
            "Make default folder — administrators; shows on Dashboard Default Folders.",
            "Star — Favorites.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Clients do not see the full organisation tree. They see their own folder and anything shared with them. Rehoming system folders is administration.",
    )


def _email(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    add_title(doc, "16. Email")
    add_body(
        doc,
        "Email is a connected mailbox for accounts that hold mail access. Clients use Messages instead. Until a mailbox is connected, the page reads No emails yet / Connect your email account to get started, with Connect email account. Connect from that button, from Settings → Connectors, or during staff setup (Connect your email).",
    )
    add_image(
        doc,
        "20-email.png",
        "Figure 20. Email. Folder chips (Inbox, Important, Starred, Snoozed, Sent, Drafts, Spam, …) and New Email.",
    )
    add_h2(doc, "Folders and views")
    add_table(
        doc,
        ["Item", "What it is"],
        [
            ["New Email", "Opens compose."],
            ["Inbox", "Incoming mail."],
            ["Important / Starred / Snoozed", "Virtual views across folders."],
            ["Sent / Draft / Spam / Trash / Archive", "Standard mailbox folders. Drafts also autosave when you compose (toast: Draft saved)."],
            ["Templates", "Mail templates."],
        ],
    )
    add_h2(doc, "Install or import your email signature")
    add_body(
        doc,
        "Open Email settings (from Email). Signatures:",
    )
    add_bullets(
        doc,
        [
            "Choose a signature — the one marked In use is added when you write a new email. Click another to switch. You can keep several (up to ten) and rename them.",
            "Click New to add a blank signature.",
            "Edit the HTML in the editor. Edits save as you type.",
            "Click Import from Outlook, Import from Gmail, or Import from mailbox (the label follows the connected provider). Import shows the signatures found in Outlook or Gmail so you can pick the right one. The mailbox must be connected or the import button is disabled.",
            "In compose, use Choose signature to pick which one goes on that message.",
        ],
        numbered=True,
    )
    add_h2(doc, "Other mail habits")
    add_bullets(
        doc,
        [
            "Compose with New Email. Layout: Inbox with preview pane, or Inbox list only.",
            "Star, flag Important, snooze, archive, or move to Trash as you would in Outlook.",
            "Manage templates from Email / Templates as well as the Templates sidebar.",
            "If Dashboard Recent Email asks you to connect a mailbox, finish Connectors first.",
        ],
    )
    add_callout(
        doc,
        "NOTE",
        "Connecting Microsoft under Connectors also unlocks Calendar and OneDrive. You connect once.",
    )


def _messages(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    add_title(doc, "17. Messages and calls")
    add_body(
        doc,
        "Messages is the portal chat. Open it from the sidebar. Search for people or conversations. Start a thread with New message. Clients can message the staff assigned to them. Staff with permission can contact more widely.",
    )
    add_image(
        doc,
        "11-messages.png",
        "Figure 21. Messages. Use Search to find a person or conversation. If you have none yet, the page reads No conversations yet.",
    )
    add_h2(doc, "Voice call and video call")
    add_body(
        doc,
        "In a conversation, click Voice call or Video call. Incoming calls can be answered with Answer, or on a phone-style prompt Slide to answer / Slide for voice only.",
    )
    add_table(
        doc,
        ["Control", "What it does"],
        [
            ["Mute microphone / Unmute microphone", "Microphone."],
            ["Turn camera on / off, Switch to video", "Camera. Turning video off leaves a voice call running (announcement: Video off. Voice call continues)."],
            ["Share your screen / Stop sharing your screen", "Share what is on your display with the other person."],
            ["Swap the large and small video", "Swap who is shown large."],
        ],
    )
    add_body(
        doc,
        "Client-call recordings, when captured, appear under Call Recordings. See section 23.",
    )
    add_callout(
        doc,
        "TIP",
        "You can also start a Voice call or Video call from Dashboard Shortcuts when that tile is on.",
    )


def _feed(doc, add_title, add_h2, add_body, add_bullets, add_table, add_image):
    add_title(doc, "18. Feed")
    add_body(
        doc,
        "Feed is the internal social area for staff with feed access. Creating a channel is allowed for staff; moderating every channel (including ones you were never added to) is administration.",
    )
    add_image(
        doc,
        "21-feed.png",
        "Figure 22. Feed. Views: All channels, My channels, Drafts, Scheduled posts, Archived posts. Search posts, people and files. Create a channel.",
    )
    add_table(
        doc,
        ["View", "What it is"],
        [
            ["All channels", "Everything published in the channels you can see."],
            ["My channels", "Channels you belong to."],
            ["Drafts", "Posts you saved. Compose shows Draft saved."],
            ["Scheduled posts", "Posts waiting for their time. Use Schedule when you compose, or Publish now."],
            ["Archived posts", "Archived items."],
        ],
    )
    add_h2(doc, "Post")
    add_bullets(
        doc,
        [
            "Click + or Create a channel to start a channel (Create channel in the dialog).",
            "Write a post, then Post, Schedule, or leave it as a draft.",
            "Search looks at posts, people, and files.",
        ],
    )


def _calendar(doc, add_title, add_h2, add_body, add_bullets, add_table, add_image):
    add_title(doc, "19. Calendar")
    add_body(
        doc,
        "Calendar shows your calendars and, for staff, shared calendars. Clients keep their own calendar and meetings they are invited to.",
    )
    add_image(
        doc,
        "12-calendar.png",
        "Figure 23. Calendar in Month view, with My Calendars on the left.",
    )
    add_table(
        doc,
        ["Control", "What it does"],
        [
            ["Month / Week / Work Week / Day (and Agenda where offered)", "Change the view."],
            ["New event / Edit event", "Create or change an event. Recurrence can be Weekly or Monthly."],
            ["Availability", "See when people are free."],
            ["Create calendar / Save changes", "Add a calendar (the + beside Calendars) and save it."],
            ["My Calendars", "Calendars such as Personal, plus any you created."],
        ],
    )
    add_body(
        doc,
        "Connect Microsoft under Connectors if you want Outlook calendar in the portal. Dashboard Upcoming Events uses the day selected on the home week strip.",
    )


def _signatures(doc, add_title, add_h2, add_body, add_bullets, add_image):
    add_title(doc, "20. Signatures")
    add_body(
        doc,
        "The sidebar label is Signatures. The page title is Signature Requests. Staff who can create requests compose and send them. Anyone can sign a request that is addressed to them. The Dashboard card Awaiting Signature counts unsigned work in the selected period.",
    )
    add_image(
        doc,
        "22-signatures.png",
        "Figure 24. Signature Requests. Status (Show All), Admin View, Export list, Signature settings, Create signature request. Empty copy: Need to get a signature? Create a request.",
    )
    add_bullets(
        doc,
        [
            "Click Create signature request (or Create signature / Send for Signature from Shortcuts).",
            "Use Status to filter. Administrators can tick Admin View.",
            "Export list downloads the current list.",
            "Signature settings holds request defaults for people who can change them.",
            "When you receive a request, open it and sign. Some review screens also offer Request changes.",
        ],
    )


def _workflows(doc, add_title, add_h2, add_body, add_table, add_image):
    add_title(doc, "21. Workflows")
    add_body(
        doc,
        "Workflows tracks file requests, comments, and items that need an update. Expand Workflows in the sidebar. Service-provider contacts can reach these pages for their own work even without the staff workflows permission.",
    )
    add_table(
        doc,
        ["Page", "Use it for"],
        [
            ["Requests", "Work waiting on you, sent by you, or all requests. Search by file name. Tabs: Waiting on you, Sent by you, All requests."],
            ["Feedback And Comments", "Comment threads you are part of (Feedback and Signature types appear in filters)."],
            ["Updates Required", "Items that still need an update — including CIP files in Updates Required."],
        ],
    )
    add_image(
        doc,
        "13-workflows.png",
        "Figure 25. Workflows / Requests. Tabs: Waiting on you, Sent by you, All requests.",
    )
    add_body(
        doc,
        "Open a row to act on the file. Dashboard Requests and Comments tiles are a home-page view of the same work.",
    )


def _reporting(doc, add_title, add_h2, add_body, add_bullets, add_image):
    add_title(doc, "22. Reporting")
    add_body(
        doc,
        "Reporting is a main sidebar page for administrators (capability settings.reporting). It is not only a Settings item.",
    )
    add_image(
        doc,
        "23-reporting.png",
        "Figure 26. Reporting. Recent Reports, Recurring Reports, Create Report.",
    )
    add_bullets(
        doc,
        [
            "Open Recent Reports or Recurring Reports.",
            "Click Create Report. CIP presets are available where the module is on.",
            "Run again to refresh a saved report.",
            "Download CSV to export.",
        ],
    )


def _calls(doc, add_title, add_h2, add_body, add_table, add_image):
    add_title(doc, "23. Call Recordings")
    add_body(
        doc,
        "Call Recordings lists captured client calls. Search by client. Employees see their own recordings; administrators see the wider set. Clients never get this page — recordings are for the firm.",
    )
    add_image(
        doc,
        "24-call-recordings.png",
        "Figure 27. Call Recordings. Empty copy: Recordings appear here after a call is captured.",
    )
    add_table(
        doc,
        ["Status", "Meaning"],
        [
            ["Ready", "The recording can be played."],
            ["Recording now", "Capture is in progress."],
            ["Interrupted", "The capture stopped before a full file."],
            ["Failed", "Capture did not succeed."],
        ],
    )


def _users(doc, add_title, add_h2, add_body, add_image):
    add_title(doc, "24. Users and People")
    add_h2(doc, "Users")
    add_body(
        doc,
        "Users is the account table for administrators. Each row shows a serial (for example #U0001), the person’s name, a status such as Active or Pending, and their email. From this page administrators approve, suspend, reset, delete, and change the type of accounts. The types you can assign here are CRO / Reviewing officer and Administrator. Client accounts are not typed by hand on this page; they arrive through invitations from a client or service-provider record.",
    )
    add_image(
        doc,
        "09-users.png",
        "Figure 28. Users. Use + to add, the filter and sort controls in the toolbar, and the checkboxes for bulk actions when they are offered.",
    )
    add_h2(doc, "People")
    add_body(
        doc,
        "People is the directory, when your account can open it: Manage Users Home, Browse Employees, Browse Client Contacts, Browse Prospects, Shared Address Book, Personal Address Book, Distribution Groups, and Resend Welcome Emails. Reaching People at all is a directory permission. Client contact screens also need client-hub access.",
    )


def _settings(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout, add_image):
    doc.add_page_break()
    add_title(doc, "25. Settings")
    add_body(
        doc,
        "Open Settings from the sidebar (Account settings). Everyone can open the page. The rail on the left only shows sections your account may use. Personal sections are always there. Firm administration appears for administrators.",
    )
    add_image(
        doc,
        "08-settings.png",
        "Figure 29. Settings. Left: settings rail. Right: My Profile (name, contact details, email, Save profile).",
    )
    add_h2(doc, "My Profile")
    add_body(
        doc,
        "Name and profile fields, email (administrators can change email), password shortcuts, 2-step verification entry points, support access, log out of all devices, delete my account. Click Save profile after edits.",
    )
    add_h2(doc, "Theme")
    add_body(
        doc,
        "Light or Dark, font size 1–5, Standard Sidebar or Hover Overlay Sidebar. See section 5. The header sun/moon is the same Light/Dark switch.",
    )
    add_h2(doc, "Time And Language (display language)")
    add_body(
        doc,
        "This is how the portal’s buttons and labels are shown. It is not a machine translation of CIP files, emails, or documents. Open Settings → Time And Language.",
    )
    add_image(
        doc,
        "26-time-language.png",
        "Figure 30. Time And Language. Automatically set time zone, Date and time, Language and Region.",
    )
    add_bullets(
        doc,
        [
            "Leave Automatically set time zone on if you want reminders, notifications and emails in the zone the device reports. Turn it off to pick a zone under Date and time.",
            "Open Language and Region. Choose Automatic (follows the browser), English, Español, Français, or 中文(简体).",
            "Reload if the labels do not switch immediately. Only languages with a shipped dictionary are listed.",
        ],
        numbered=True,
    )
    add_image(
        doc,
        "27-language.png",
        "Figure 31. Language list: Automatic, English, Español, Français, 中文(简体).",
    )
    add_h2(doc, "Notifications")
    add_body(
        doc,
        "Email notifications, always send email, copy me on service provider emails (staff: administrators are copied on every CIP application, CROs on the files they hold; the bell still shows every change), toast behaviour, and per-module Portal / Email / Desktop / Sound. Security & Approvals on the portal channel stays on.",
    )
    add_h2(doc, "Privacy")
    add_body(
        doc,
        "Who can see when I’m online, Who can see my last seen, Read receipts, Typing indicator, History.",
    )
    add_h2(doc, "Account Security and two-factor authentication")
    add_body(
        doc,
        "Under Settings → Security → Account Security (and from My Profile). Password, connected Google/Microsoft accounts, phone number for alerts and recovery, and Two-factor authentication.",
    )
    add_image(
        doc,
        "28-two-step.png",
        "Figure 32. Account Security. Password, Connected accounts, Phone number, Two-factor authentication.",
    )
    add_bullets(
        doc,
        [
            "Open Two-factor authentication / 2-step verification.",
            "Turn 2-step verification on. Add Authenticator app (for example Google Authenticator: Scan QR code in authenticator app, then enter the six-digit code), Phone number, or Email.",
            "Adjust the sorting to change the default 2-step verification method.",
            "You cannot turn this off if firm policy requires it.",
        ],
        numbered=True,
    )
    add_h2(doc, "Connectors")
    add_body(
        doc,
        "Link your Microsoft account for Outlook, Calendar, and OneDrive. Connect once. Outlook, Calendar and OneDrive link together.",
    )
    add_h2(doc, "What you should avoid changing without a reason")
    add_bullets(
        doc,
        [
            "Do not turn off two-factor authentication if your administrator requires it.",
            "Do not delete your account unless you intend to leave the portal.",
            "Do not click Log out of all devices unless you mean to sign every browser and phone out.",
            "Leave Security & Approvals portal notifications on.",
        ],
    )
    add_h2(doc, "Administrator settings")
    add_body(
        doc,
        "These rail groups appear only if your account holds the matching permission. A CRO / Reviewing officer and a client do not see them.",
    )
    add_table(
        doc,
        ["Group / item", "What it is for"],
        [
            ["Background Operations", "Long-running jobs: mail import, calendar import, OneDrive sync, outbound email."],
            ["Notification History", "Every email the portal has sent (invites, CIP status letters, and the rest). Filter by date, recipient, and status: Queued, Sent, or Failed. Opened/read receipts are not shown here."],
            ["Edit Company Branding", "Company name, logo, and colours."],
            ["CIP Console — Administrator", "CIP administration."],
            ["CIP Console — Access", "Who on staff may use the client hub (same destination as Manage access)."],
            ["CIP Console — Service Teams", "Same as Manage service teams."],
            ["CIP Console — Custom Fields", "Same as Manage custom fields."],
            ["CIP Console — Document Requirements", "Same as Manage documents."],
            ["CIP Console — Granted And Denied Letters", "Same as Manage decision letters."],
            ["CIP Console — Distribution Group", "Same as Manage distribution group."],
            ["Security Insights / Sign In Policy / Security Policy / Security Alert Settings / Configure Device Security", "Firm-wide sign-in, password, two-factor, and device policy."],
            ["Storage — Usage", "Storage against the licence."],
            ["Advanced Preferences — Permissions", "Whether employees hold extra directory permissions."],
            ["Default Folders / Folder Templates", "File Library defaults and templates."],
        ],
        col_twips=[3510, 6930],
    )
    add_callout(
        doc,
        "NOTE",
        "Reporting also lives as a main sidebar page. Open Reporting from the menu when you need firm-wide reports.",
    )


def _roles(doc, add_title, add_h2, add_body, add_table, add_callout):
    add_title(doc, "26. Account Types and Permissions")
    add_body(
        doc,
        "The portal stores an account type on each user. Administrators hold every capability the environment allows. Other types hold a fixed set. Two overlays administrators can change: Client hub access and Advanced Preferences → Permissions.",
    )
    add_table(
        doc,
        ["Account type", "Can access", "Cannot access"],
        [
            [
                "Client (including invited private clients and service-provider contacts)",
                "Dashboard without staff KPI cards; Messages with assigned staff; own calendar; own and shared files; sign requests sent to them; personal Settings. CIP only if they are a private client or a service-provider contact on the hub. Workflows for their own CIP work. Lodge New Appeal on their decided file when allowed.",
                "Users, Reporting, Templates administration, CIP Console, assigning officers, driving CIP status (except New Appeal), Call Recordings, organisation-wide File Library, Feed, staff Email unless granted by a hub overlay that does not apply to clients.",
            ],
            [
                "Employee (parked)",
                "Nothing in the working portal. The account is recognised so it can be converted.",
                "Cannot sign in to work. Not offered on the Users page when creating a type. Ask an administrator to assign CRO / Reviewing officer or Administrator.",
            ],
            [
                "CRO / Reviewing officer (working staff — what people usually mean by employee)",
                "Staff baseline: Dashboard with KPIs, Overview, Email, Messages (including calls and screen share), Feed, Calendar, Signatures (create), File Library organisation tree, Workflows, Call Recordings (own recordings), CIP view/create/review/compliance/decide, personal Settings, Theme, language, Connectors.",
                "Users page management, Reporting, assigning CIP files, CIP configure (letters/requirements at firm level), status overrides, approving person-detail change requests, firm branding, security policy, Advanced Preferences, Feed moderation of channels they do not belong to.",
            ],
            [
                "Administrator",
                "Everything the environment has switched on, including Users, Reporting, CIP assign and configure, Manage dropdown, branding, security policy, default folders.",
                "Only modules switched off for the whole environment (for example CIP if FEATURE_CIP is off).",
            ],
        ],
        col_twips=[2700, 3870, 3870],
    )
    add_callout(
        doc,
        "NOTE",
        "Older spellings Reviewing Officer and Compliance Officer still mean CRO / Reviewing officer. The Users page does not offer Employee or Client as types you can hand out.",
    )


def _activity(doc, add_title, add_h2, add_body, add_bullets, add_table, add_callout):
    add_title(doc, "27. Notifications and recent activity")
    add_h2(doc, "Notification bell")
    add_body(
        doc,
        "The bell in the header opens notifications. Unread items show a badge. Notification History in Settings (administrators) lists firm-wide history. Choose which channels you receive under Settings → Notifications.",
    )
    add_h2(doc, "Activities (recent activity)")
    add_body(
        doc,
        "The right-hand Activities list is the recent activity stream — the closest thing to a “recent being” of what just happened. It is not a separate product named Recent being. Open Toggle right panel → Activities, or Overview → Activity for the full log, or the Activity tab on a CIP file.",
    )
    add_body(
        doc,
        "CIP applications write into this stream when status changes: the application number moved to the new status (or pulled from one status to another on an override). Document actions, invitations, and sign-ins also appear. That is how CIP and the rest of the portal stay in one activity history.",
    )
    add_h2(doc, "Emails the portal sends")
    add_body(
        doc,
        "Typical messages include Your sign-in code, password reset, password changed, two-factor changed, invitations, and CIP notices. Wording can be edited by administrators under Templates → System Emails. Support copy in those messages uses support@tmantoine.com.",
    )


def _common(doc, add_title, add_table):
    add_title(doc, "28. Common Tasks")
    add_table(
        doc,
        ["Task", "Where to start"],
        [
            ["Sign in", "Sign in page → Google, Microsoft, or Email."],
            ["Change Light / Dark", "Header sun/moon, or Settings → Theme."],
            ["Change sidebar hover vs click", "Settings → Theme → Sidebar style."],
            ["Set Available / DND / In Office", "Header status → pick a status, or Status settings…"],
            ["Detect office vs remote", "Status settings… → Work locations → Enable automatic detection."],
            ["Schedule Out of Office", "Status settings… → Scheduled statuses."],
            ["Hide a dashboard tile", "Dashboard → Edit Dashboard → turn the switch off."],
            ["Open a recent CIP folder", "Dashboard → Recent Files, or File Library → Recent."],
            ["Install Windows / Mac / Android", "Overview → Windows, macOS, or Android 8+."],
            ["Open a CIP file", "CIP Applications → click the application number."],
            ["Start a CIP file", "CIP Applications → Create New Application."],
            ["Register a service provider", "CIP Applications → Create New Application → New service provider → Create."],
            ["Invite a service provider to sign in", "Open the provider → Access → enter email → Add (administrators). Or open a contact → Invite to portal."],
            ["Put a post-approval file under a service provider", "On Create New Post-Approval Application, select Service provider before Add. A granted file already in the portal keeps the provider chosen at original filing when you move it to Post-Approval."],
            ["See if the provider was emailed an approval", "Settings → Account And Reporting → Notification History. Filter by their email. Subject includes GRANTED or APPROVED and the application number."],
            ["Message the provider on a file", "Open the file → Message."],
            ["Request a name/DOB correction (CRO)", "Open the file → Edit → Save (waits on an administrator)."],
            ["Import an email signature", "Email settings → Import from Outlook / Gmail / mailbox."],
            ["Start a video call / share screen", "Messages → Video call → Share your screen."],
            ["Pin a folder to the main menu", "File Library → right-click → Add to Folder Shortcuts."],
            ["Colour-code a folder", "File Library → Folder appearance."],
            ["Change language", "Settings → Time And Language → Language and Region."],
            ["Turn on authenticator 2FA", "Settings → Account Security → Two-factor authentication → Authenticator app → Scan QR code."],
            ["Connect Outlook / Calendar / OneDrive", "Settings → Connectors."],
            ["Sign out", "Sign-out icon at the bottom of the sidebar."],
        ],
        col_twips=[3510, 6930],
    )


def _trouble(doc, add_title, add_table):
    doc.add_page_break()
    add_title(doc, "29. Troubleshooting")
    add_table(
        doc,
        ["What you see", "What to do"],
        [
            ["Sign in does not continue", "Check email and password. Use Forgot password?. Try All sign in options and another method if you usually use Google or Microsoft."],
            ["Let’s confirm it’s you", "Enter the code from Your sign-in code. Wait for Resend if you need another. Check junk mail."],
            ["Account is under review", "Wait for an administrator to approve the account."],
            ["The portal is under development", "Your account is still Employee. Ask an administrator to assign CRO / Reviewing officer or Administrator."],
            ["A sidebar item is missing", "Your account does not have that area. That is expected, not a broken menu."],
            ["CIP Applications is missing or empty of controls", "You may not have CIP access, or the CIP module is off. Ask an administrator."],
            ["Cannot submit a CIP intake", "Complete every field marked with an asterisk and the required files, then use Add. Use Save as draft if you are not ready. Confirm Draft saved appeared if you are still typing."],
            ["Cannot assign an officer", "Only administrators assign CIP files (staff reviewers). That is not how you attach a service provider — pick Service provider on the intake form."],
            ["No way to assign this file to another service provider", "The firm is set at Create / Add and is not edited later. File a new application under the correct provider, or keep this file with the original firm."],
            ["Save on Edit application did not change the name", "If you are not an administrator, you created a change request. Wait for an administrator."],
            ["Message the service provider is disabled", "The applicant is not linked to a provider. Attach a provider on the file first."],
            ["New service provider is missing from Create New Application", "External CIP users do not get that item. Staff need client-hub manage access."],
            ["No email + Add on the provider Access card", "Only administrators invite from Access. A CRO uses Invite to portal on a contact instead."],
            ["Could not send the invitation / Invite failed", "Check the address, then Resend or Try again. Confirm the mailbox can receive mail from the portal."],
            ["Service provider did not get the approval email", "Confirm the file’s Service provider is that firm, and that the person is an Access / Provider contact with an email. Then Settings → Account And Reporting → Notification History: filter by their address. Queued means it has not left yet; Failed means it bounced or the worker could not send it."],
            ["Invitation expired", "Open the contact or Access row and Resend. Default expiry is 7 days unless your firm changed it."],
            ["Email tile says connect a mailbox", "Settings → Connectors, or Connect email account on Email."],
            ["Windows download says not commonly downloaded / not verified", "Click Keep, then Keep anyway. Open the installer. If SmartScreen appears, More info → Run anyway."],
            ["macOS will not open the app", "System Settings → Privacy & Security → allow / Open Anyway."],
            ["Status will not switch to In Office by itself", "Enable automatic detection, allow location, and confirm you are inside the office radius. A call or a manual status can override it."],
            ["Signed out unexpectedly", "Sign in again. If the session expired, the portal says so on Sign in."],
            ["Authenticator required", "Settings → Account Security and complete two-factor. You cannot skip this if policy requires it."],
        ],
        col_twips=[3510, 6930],
    )


def _faq(doc, add_title, add_h2, add_body):
    add_title(doc, "30. Frequently Asked Questions")
    add_h2(doc, "Why don’t I see Users, Reporting, or CIP Console?")
    add_body(doc, "Those areas are administration. Only accounts with the matching permission see them. A CRO / Reviewing officer will not see them.")
    add_h2(doc, "Why don’t I see Email?")
    add_body(doc, "Email is for staff with mail access. Clients use Messages instead.")
    add_h2(doc, "I am staff — why does the portal say it is under development?")
    add_body(doc, "Your type is still Employee. Working staff must be CRO / Reviewing officer or Administrator.")
    add_h2(doc, "Can I turn off the email sign-in code?")
    add_body(
        doc,
        "On a private computer, leave Trust this browser checked so this browser skips the code for the trust period. A new browser, phone, or cleared cookies will ask again.",
    )
    add_h2(doc, "Does the site auto-translate CIP files?")
    add_body(
        doc,
        "No. Settings → Time And Language → Language and Region changes the portal’s own labels (Automatic, English, Español, Français, 中文). Application content stays in the language it was typed.",
    )
    add_h2(doc, "How do I invite a service provider?")
    add_body(
        doc,
        "CIP Applications → Create New Application → New service provider → fill the name → Create. Then, as an administrator, open the provider → Access → type their email → Add. The toast Invitation sent means mail went out. They follow You’re invited to join {company} and finish the client welcome screens. A CRO who cannot see Add on Access should open the contact and click Invite to portal. Do not add them on Users.",
    )
    add_h2(doc, "How do I assign a post-approval file to a service provider?")
    add_body(
        doc,
        "You select the firm on the application, you do not assign it afterwards. For a new post-approval filing: Create New Application → Create New Post-Approval Application → Service provider → Add. For a file that was already Approved in this portal: open it and move the status to Post-Approval — it stays with the provider chosen when it was first filed. Assign an officer is only which staff member reviews the file. To let the firm’s people open the file, invite them (see How do I invite a service provider?).",
    )
    add_h2(doc, "How can I tell if the service provider got the approval notice?")
    add_body(
        doc,
        "When staff record Approved (pre-approval grant) or the post-approval Approved outcome, the portal emails the section 22 list: the CIP Distribution Group, the assigned officer, administrators, and the service provider’s contacts (active members of that firm, plus the firm’s contact and company email when those are set). The subject looks like VF - GRANTED - GAL26-00001 - CHEN WEI (F1) - 10.09.2026 (GRANTED for the pre-approval grant, APPROVED for the post-approval outcome).",
    )
    add_body(
        doc,
        "An administrator checks Settings → Account And Reporting → Notification History. Filter Recipient to the provider contact’s email and look at Status: Queued (still waiting to leave), Sent (the mail server accepted it), or Failed (it did not go out — read the error under the chip). The Activity tab on the file shows that the decision was recorded, which is what triggers the letter; it does not list each mailbox. Contacts who have a portal account also get a bell notification. The history page does not show whether they opened the email.",
    )
    add_h2(doc, "What is the difference between Save as draft and Add?")
    add_body(
        doc,
        "Save as draft (and autosave) keep a CIP intake in Draft. Add files the application into New Applications after required information is present.",
    )
    add_h2(doc, "Who do I contact if something is wrong?")
    add_body(
        doc,
        "Email support@tmantoine.com. Privacy questions may use portal@tmantoinelaw.com. A phone number for the helpdesk is not published in the portal. [Information Required] if your firm uses a different internal contact.",
    )


def _support(doc, add_title, add_body, add_table):
    add_title(doc, "31. Support")
    add_table(
        doc,
        ["Item", "Detail"],
        [
            ["Portal", "https://portal.tmantoinelaw.com"],
            ["Support email", "support@tmantoine.com"],
            ["Privacy contact", "portal@tmantoinelaw.com"],
            ["Phone / hours", "[Information Required]"],
        ],
    )
    add_body(
        doc,
        "When you write to support, include the page you were on, the account email, the application number if it is a CIP file, and what you clicked. Do not send sign-in codes or authenticator codes.",
    )
    add_body(doc, "End of guide.")
