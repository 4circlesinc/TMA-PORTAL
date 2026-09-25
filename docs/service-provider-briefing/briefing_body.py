"""Copy for the TM ANTOINE Service Provider Portal Briefing."""

from __future__ import annotations


def write_briefing(doc, h):
    add_title = h.add_title
    add_h2 = h.add_h2
    add_body = h.add_body
    add_bullets = h.add_bullets
    add_table = h.add_table
    add_callout = h.add_callout
    add_image = h.add_image

    add_title(doc, "Why this briefing exists")
    add_body(
        doc,
        "This document is for service-provider firms that will use the TM ANTOINE Advisory Portal. It is written in plain language so a director, a compliance officer, or a case handler can read it in one sitting. It is the same material we present at the webinar, and it is the copy we send afterwards so it is on file before accounts are activated.",
    )
    add_body(
        doc,
        "The portal is the firm's working system for Citizenship by Investment files: applications, documents, messages, and status. It is not a licensed white-label product. It was designed and built in-house by TM ANTOINE Partners & Advisors for this practice.",
    )
    add_callout(
        doc,
        "NOTE",
        "The controls below are in place today. We have already done security testing on the portal — including checks for injection, unsafe uploads, and access between accounts. That work is not finished. A full independent penetration test is still under way. We do not hold ISO 27001 or SOC 2 at this time. We say that plainly so you can judge the platform on facts, not on marketing.",
    )

    add_title(doc, "Authenticity and the two domains")
    add_body(
        doc,
        "You may see two related names. That is not two products. It is one firm, with a staging address that is no longer used for live work.",
    )
    add_table(
        doc,
        ["You may see", "What it is"],
        [
            ["portal.tmantoinelaw.com", "The live portal. Bookmark this."],
            ["portal@tmantoinelaw.com", "The correct mailbox for portal mail from TM ANTOINE."],
            ["support@tmantoinelaw.com", "Support. Shared with TM ANTOINE administrators. Aim: a reply within an hour, subject to people being available."],
            ["support@tmantoine.com", "Used for staging. Do not treat it as the live contact."],
        ],
        col_twips=[3600, 6840],
    )
    add_body(
        doc,
        "If an invitation, a sign-in page, or a message does not match portal.tmantoinelaw.com, stop and write to support@tmantoinelaw.com before you enter a password or a code.",
    )

    add_title(doc, "Who can enter the portal")
    add_body(
        doc,
        "There are four kinds of access. Service-provider people only ever hold the first two. The last two belong to TM ANTOINE.",
    )
    add_image(
        doc,
        "chart-access.png",
        "Figure 1. The four account types. Service-provider firms use the first two.",
        width=6.45,
    )
    add_table(
        doc,
        ["Access", "In two sentences"],
        [
            [
                "Service provider",
                "A named person at your firm. They can open every CIP application that belongs to your company, not only the ones they created, and they can work those files, messages, and documents.",
            ],
            [
                "Service provider admin",
                "The person your firm names to TM ANTOINE. They invite colleagues and remove them when someone leaves or changes role. They cannot register a new firm, change the CIP code, or promote someone else to this role — that stays with TM ANTOINE.",
            ],
            [
                "CRO / reviewing officer",
                "A TM ANTOINE officer who reviews files. They are not a member of your firm. They see the work that has been assigned to the practice.",
            ],
            [
                "Administrator",
                "A TM ANTOINE administrator. They approve new accounts before anyone can sign in, and they hold firm-wide settings. No service-provider person is an administrator of the portal.",
            ],
        ],
        col_twips=[2700, 7740],
    )
    add_h2(doc, "How a person at your firm gets an account")
    add_image(
        doc,
        "chart-account-flow.png",
        "Figure 2. Invitation, acceptance, then TM ANTOINE approval. The last step is required.",
        width=6.45,
    )
    add_body(
        doc,
        "TM ANTOINE will ask each service-provider firm to name one administrator. Only that person can add and remove accounts on your side. When they remove someone, TM ANTOINE administrators are notified. Removing a person who has left your organisation is your duty; we will not guess who still works for you.",
    )
    add_callout(
        doc,
        "SECURITY",
        "An invitation is not enough. The account stays closed until a TM ANTOINE administrator approves it. That is a second human check, on purpose.",
    )

    add_title(doc, "How sign-in works today, and what changes after this webinar")
    add_body(
        doc,
        "Today the portal uses a dual check. On the first sign-in from a known setup you complete the usual email path. If the device changes, the portal asks for a six-digit code. That code is sent only to the email address already on the account. It is not sent to a new address the visitor types in.",
    )
    add_image(
        doc,
        "02-login-options.png",
        "Figure 3. Sign-in on portal.tmantoinelaw.com. Use the live host, not a look-alike.",
        width=5.8,
    )
    add_image(
        doc,
        "03-login-code.png",
        "Figure 4. A six-digit email code. Codes are never asked for by chat, and support will never request yours.",
        width=5.8,
    )
    add_h2(doc, "Authenticator app — required after this webinar")
    add_body(
        doc,
        "After this session we will require every service-provider account to connect an authenticator app (for example Google Authenticator, Microsoft Authenticator, or Authy). The app sits on your phone and shows a new six-digit code every thirty seconds. Even if someone has your password and your email, they still cannot sign in without that phone.",
    )
    add_image(
        doc,
        "28-two-step.png",
        "Figure 5. Settings → Account Security. Connect Authenticator app, then keep the recovery codes in a safe place that is not email.",
        width=6.2,
    )
    add_bullets(
        doc,
        [
            "Open Settings → Account Security → Two-factor authentication.",
            "Choose Authenticator app, scan the QR code, enter the six-digit code the app shows.",
            "Store the recovery codes offline. They are the only way back in if the phone is lost.",
            "Do not share authenticator codes in Messages, email, or with Bespoke AI.",
        ],
        numbered=True,
    )
    add_h2(doc, "What else sits on the sign-in door")
    add_body(
        doc,
        "Before an account is created or a password is checked, Cloudflare Turnstile asks the visitor to prove they are a person. That stops the bulk of automated guessing before it reaches the application. Sign-in attempts are also rate-limited: roughly five tries a minute for a given email and network address. After that, the portal refuses further attempts for a short period.",
    )
    add_body(
        doc,
        "A device you have already completed a check on can be remembered as a trusted device. You can see those devices under Settings → Account Security, end any one of them, or sign out every other session from that same screen. Ending a session also invalidates the long-lived remember cookie on that device.",
    )
    add_callout(
        doc,
        "SECURITY",
        "If a laptop is lost or a colleague leaves, revoke their account and, for the person still in the firm, end other sessions from Account Security. Do not wait for the next webinar.",
    )

    add_title(doc, "Where the portal may be used")
    add_body(
        doc,
        "Access is limited to countries where TM ANTOINE's service-provider clients actually operate. We do not leave the door open to the rest of the world. North Korea, South Korea, and Russia are among the locations that cannot reach the portal. The country is read at the network edge, before a session is created, so a refused visitor never reaches sign-in.",
    )
    add_body(
        doc,
        "A virtual private network (VPN) or anonymising proxy is treated as a way around that rule. The portal can refuse those connections. If you are travelling and the page asks you to turn a VPN off, that is the control working, not a fault.",
    )
    add_callout(
        doc,
        "NOTE",
        "Geography is one control beside passwords, codes, and roles. It is not the whole of security. A determined attacker with a residential proxy can still look local. That is why the other layers exist.",
    )

    add_title(doc, "How we protect the connection and the files")
    add_image(
        doc,
        "chart-layers.png",
        "Figure 6. Six layers. None of them is enough on its own.",
        width=6.45,
    )
    add_h2(doc, "Encryption, in ordinary words")
    add_image(
        doc,
        "chart-encryption.png",
        "Figure 7. Four places encryption does work you can explain to a client.",
        width=6.45,
    )
    add_body(
        doc,
        "In transit means the path between your browser and the portal. That path uses TLS — the lock in the address bar, the same idea as online banking. A packet-capture tool on the network (the family of products people know as Wireshark) can see that traffic is happening. It cannot read the pages, the passwords, or the files.",
    )
    add_body(
        doc,
        "At rest means the file sitting in storage when nobody is looking at it. Vault files are stored as ciphertext, not as an open PDF on a disk. The portal holds the key so officers can still open, scan, e-sign, and sync a file. This is not a zero-knowledge vault: TM ANTOINE can open a file that you can open, because that is required to run the practice. What a stranger on the storage platform cannot do is read the bytes as a document.",
    )
    add_body(
        doc,
        "Field-level encryption goes one step further for the most sensitive typed values. Passport numbers and dates of birth are encrypted in the database itself. A stolen database dump does not hand those fields to an attacker in clear text. Call recordings use the same vault envelope encryption as other media files.",
    )
    add_h2(doc, "Intercepting tools, the browser, and injection")
    add_body(
        doc,
        "The portal sits behind Cloudflare. Automated scanners, known attack signatures, and many intercepting proxy tools are filtered at that edge before they reach the application. Requests that do get through still need a signed-in session. They are checked again on the server for every action — opening a file, changing a status, sending a message. The browser is not trusted to decide who may do what.",
    )
    add_body(
        doc,
        "Every page also carries security headers the browser is expected to obey: a content security policy, HSTS so the connection stays on HTTPS, framing protections against clickjacking, and related permissions limits. Uploaded files are never executed by the web server; only the application itself is passed to PHP.",
    )
    add_body(
        doc,
        "API keys, mail credentials, and cloud secrets are stored on the server only. They are not in the web page, not in Bespoke AI, and not in a file a service provider can download. The assistant is forbidden from repeating hosting details, keys, or internal infrastructure. If a document tries to instruct the assistant to ignore those rules, the portal treats that text as data, not as an order.",
    )
    add_h2(doc, "Watching for unusual activity")
    add_body(
        doc,
        "Sign-in events record the account, the network address, the device, and the country when Cloudflare can see it. Separate detectors flag patterns that deserve a human look: a sign-in that would require impossible travel between two places, a sudden rise in distinct addresses against one account, one address trying many accounts, or a burst of downloads. Those flags are for review. They do not silently lock a working officer out of an active file.",
    )
    add_callout(
        doc,
        "HONESTY",
        "We have already tested the portal against common attacks. A full independent penetration test is not complete yet. We do not hold ISO 27001 or SOC 2. We will share the outcome when that work is done.",
    )

    add_title(doc, "What may be uploaded")
    add_body(
        doc,
        "CIP application uploads are PDF files or images (photograph formats such as JPEG, PNG, WebP, and HEIC). The portal does not take the filename at its word. It reads the first bytes of the file. A renamed program — a so-called PDF that is actually software — is refused.",
    )
    add_body(
        doc,
        "Public upload links, the door a person who is not signed in can push a file through, are capped at 5 or 10 megabytes. That is a security limit as well as a practical one: a huge file is a common way to hide a payload or to knock a service over. Other doors in the portal have their own caps; none of them is unbounded.",
    )
    add_body(
        doc,
        "Every uploaded file is queued for a malware scan. A file that fails the scan cannot be opened or downloaded. Colleagues on the same file are not used as a way to spread it.",
    )
    add_body(
        doc,
        "Public share links to identity documents must carry a password. A forwarded link alone is not enough to open a passport scan or similar document. The person who receives the link still needs the password you agreed to share by a separate channel.",
    )
    add_table(
        doc,
        ["Rule", "What it means for you"],
        [
            ["PDF or image for CIP", "Do not zip executables or office macros into an application folder and hope the name looks harmless."],
            ["5–10 MB on request links", "Split a very large scan, or compress a photograph, rather than sending a 200 MB archive."],
            ["Malware scan", "If a file is blocked, replace it with a clean original. Do not ask someone to 'just download it anyway'."],
            ["Password on identity shares", "When you send a public link to a passport or ID page, set a password and send that password separately."],
        ],
        col_twips=[2700, 7740],
    )

    add_title(doc, "Where things live, and how they come back")
    add_body(
        doc,
        "The application and its database run together on Laravel Cloud, on Amazon Web Services, in the United States. They are not split across two unrelated computer rooms. In front of that sits Cloudflare. Document bytes sit in a private object store (Cloudflare R2) and are mirrored to Microsoft 365 / SharePoint.",
    )
    add_image(
        doc,
        "chart-backup.png",
        "Figure 8. Three copies: the working store, the Microsoft mirror, and the daily host backup.",
        width=5.6,
    )
    add_table(
        doc,
        ["Copy", "What it is for"],
        [
            ["Portal store (R2)", "The files you open while you work. Encrypted at rest."],
            ["Microsoft 365 / SharePoint", "A live mirror. If the portal is down, the firm's document set is still in SharePoint."],
            ["Daily host backup", "A once-a-day copy of the site on Laravel Cloud, for disaster recovery of the application itself."],
        ],
        col_twips=[2700, 7740],
    )
    add_body(
        doc,
        "There is an audit record of activity on the site: who did what, and when, including access to documents. That log is not a screen a user can edit. Sign-in history is kept for review and is pruned on a long retention cycle so the table does not grow without limit.",
    )
    add_h2(doc, "Call recordings")
    add_body(
        doc,
        "Where the portal stores a call recording, access is logged. A recording can be placed on legal hold so routine retention does not delete it. When legal hold is off and the retention date has passed, a scheduled job removes the recording. The media itself is vault-encrypted at rest, the same way other sensitive files are.",
    )

    add_title(doc, "Bespoke AI — use it")
    add_body(
        doc,
        "The portal includes a built-in assistant named Bespoke AI. It answers questions about this portal: how a workflow moves, which field is required, who to write to when something is wrong. It is not a general chatbot. It cannot see other firms' files. It cannot see API keys. It cannot change a file until you confirm the action on screen.",
    )
    add_bullets(
        doc,
        [
            "Ask how a Pre-Approval or Post-Approval step works, in the language you already use.",
            "Ask what is still missing on the application you have open.",
            "Ask who to contact about a portal fault — it will point you to support@tmantoinelaw.com and to Messages.",
            "Do not paste passwords, authenticator codes, or passport numbers into the assistant unless you are asking about a field that already holds that data on the page.",
        ],
    )
    add_callout(
        doc,
        "TIP",
        "If you are stuck, ask Bespoke AI before you wait on email. For a true outage or an account that cannot sign in, email support@tmantoinelaw.com.",
    )

    add_title(doc, "If something goes wrong")
    add_image(
        doc,
        "11-messages.png",
        "Figure 9. Built-in Messages. You can write to TM ANTOINE administrators from inside the portal when you can still sign in.",
        width=6.2,
    )
    add_body(
        doc,
        "When the portal itself is the problem — an error page, a file that will not upload, an outage during an active application — write to support@tmantoinelaw.com. That mailbox is shared with TM ANTOINE administrators, so it does not depend on one person being at their desk. Target response is within an hour, pending availability.",
    )
    add_table(
        doc,
        ["Person", "Role in support"],
        [
            ["Vernon Francis", "Primary technical contact for portal faults."],
            ["Cindy McLean", "TM ANTOINE administrator. Reachable by email or Messages."],
            ["Emmanuel McLean", "TM ANTOINE administrator. Reachable by email or Messages."],
            ["Krishna Manru", "TM ANTOINE administrator. Reachable by email or Messages."],
        ],
        col_twips=[2700, 7740],
    )
    add_body(
        doc,
        "In the message include the page you were on, the account email, the CIP application number if there is one, and what you clicked. Never include a sign-in code or an authenticator code.",
    )

    add_title(doc, "Questions we have already been asked")
    add_body(
        doc,
        "The answers below are the ones we want on file with your compliance team. They match this briefing. Where work is still in progress, the sentence says so.",
    )

    add_h2(doc, "1. Authenticity and ownership")
    add_table(
        doc,
        ["Question", "Answer"],
        [
            [
                "The invitation mentioned support@tmantoine.com, while the portal is on tmantoinelaw.com. How are the domains related?",
                "One firm. portal.tmantoinelaw.com and portal@tmantoinelaw.com are live. support@tmantoine.com was used for staging. Use support@tmantoinelaw.com from now on.",
            ],
            [
                "Is the portal built in-house, or a licensed / white-label platform? If the latter, who is the vendor?",
                "Built in-house by TM ANTOINE. There is no underlying portal vendor to name.",
            ],
        ],
        col_twips=[3600, 6840],
    )

    add_h2(doc, "2. Security")
    add_table(
        doc,
        ["Question", "Answer"],
        [
            [
                "Where is the portal hosted (provider and data-centre region)?",
                "Laravel Cloud on Amazon Web Services, United States, with Cloudflare in front.",
            ],
            [
                "Is data encrypted in transit (TLS) and at rest?",
                "Yes. HTTPS/TLS on the path. Vault files and call recordings stored as ciphertext. Passport numbers and dates of birth are also encrypted at field level in the database.",
            ],
            [
                "Is multi-factor authentication available or enforced for service-provider accounts?",
                "Available today: a six-digit code to the email on file when the device changes. After this webinar, an authenticator app will be required for every service-provider account. Cloudflare Turnstile and a five-attempt-per-minute throttle also sit on the sign-in door.",
            ],
            [
                "Can a person revoke devices and other sessions?",
                "Yes. Settings → Account Security lists trusted devices and active sessions. You can end one device or sign out every other session from that screen.",
            ],
            [
                "What browser and edge protections are in place?",
                "Cloudflare filters hostile traffic. Pages send CSP, HSTS, framing, and related security headers. Uploaded files are never executed by the web server.",
            ],
            [
                "Is unusual activity monitored?",
                "Yes. Sign-in events are recorded. Detectors flag impossible travel, address spikes, one address against many accounts, and download bursts for human review — they do not auto-lock a working account.",
            ],
            [
                "What can a company member see — every application for our company, or only ones they create?",
                "Every application for the company. Membership is at firm level, not at 'my files only'. Access to each file and action is still checked on the server against the person's role.",
            ],
            [
                "How are public links to identity documents protected?",
                "Public share links to identity documents must carry a password. A forwarded URL alone is not enough.",
            ],
            [
                "How are call recordings protected?",
                "Access is logged. Legal hold can stop routine deletion. Past-retention recordings without hold are pruned. Media is vault-encrypted at rest.",
            ],
            [
                "Independent testing (penetration test, vulnerability scan) or ISO 27001 / SOC 2?",
                "We have done security testing on the platform, including injection, unsafe uploads, and access between accounts. A full independent penetration test is not complete yet. We do not currently hold ISO 27001 or SOC 2. We will share the outcome when that work is finished.",
            ],
            [
                "Backup and disaster recovery?",
                "Working files in the portal store; a Microsoft 365 / SharePoint mirror; a daily backup of the site with the hosting provider.",
            ],
            [
                "Is there an audit log of who accessed or downloaded a document?",
                "Yes. Activity on the site is recorded: who, what, when. Users cannot edit that record. Sign-in history is kept and pruned on a long cycle.",
            ],
        ],
        col_twips=[3600, 6840],
    )

    add_h2(doc, "3. Data protection and GDPR")
    add_body(
        doc,
        "Where the GDPR (or a similar regime) applies to your clients' personal data, the questions below are the ones we expect on your compliance file. We do not claim a GDPR certificate or an ISO privacy seal. We describe what is built, what we will contract for, and what is still being written down.",
    )
    add_table(
        doc,
        ["Question", "Answer"],
        [
            [
                "Are you GDPR compliant / certified?",
                "We do not hold a GDPR certification, and we do not market one. Where GDPR (or a similar regime) applies to personal data you place in the portal, we support that work through a DPA, Standard Contractual Clauses where they are the right tool, documented sub-processors, retention and deletion on request, and breach notification. Your counsel decides whether that package is enough for your file.",
            ],
            [
                "Will TM ANTOINE sign a Data Processing Agreement covering data processed through the portal?",
                "Yes, subject to review by our legal team. We will work from your paper or ours.",
            ],
            [
                "Saint Lucia has no EU adequacy decision. What safeguard applies to personal data of your clients?",
                "We collect only what the various applications require. We transfer onwards only what the Citizenship by Investment Unit, the National Insurance Corporation, and the Immigration Department need, as we did before the portal. A DPA, and Standard Contractual Clauses where they are the right tool, remain a matter for legal review with your firm.",
            ],
            [
                "What data-subject rights do you support (access, correction, erasure)?",
                "An applicant (or your firm on their behalf) can ask us for a copy of what we hold, to correct it, or to delete it after the case is closed. We keep the file unless that deletion request is made. Operational logs needed for security and dispute handling may be retained for a limited period after deletion of the working file.",
            ],
            [
                "Retention and deletion of applicant documents after a case closes?",
                "We keep the file unless the applicant asks us to delete it after the case is closed. Documents sit in Cloudflare R2, with the Microsoft mirror described above. Call recordings follow their own retain-until / legal-hold rules.",
            ],
            [
                "Where are the Privacy Policy and Terms of Service?",
                "On the live portal: https://portal.tmantoinelaw.com/privacy-policy/ and https://portal.tmantoinelaw.com/terms-of-service/. New accounts accept both before they work the files.",
            ],
            [
                "Sub-processors, and where they are?",
                "Laravel Cloud on AWS (United States) for the application and database. Cloudflare (including R2). Microsoft 365 / SharePoint for the document mirror. Email delivery is from the portal's own mail stack on that host.",
            ],
            [
                "Breach notification process and timeline?",
                "The written playbook is being finalised. Detection is continuous (sign-in events, country, unusual download volume, malware, anomaly flags). If a breach of personal data is confirmed, we will notify affected firms without delay and will not wait for a newsletter cycle.",
            ],
        ],
        col_twips=[3600, 6840],
    )

    add_h2(doc, "4. Operational")
    add_table(
        doc,
        ["Question", "Answer"],
        [
            [
                "Who can grant or revoke service-provider accounts on our side? What happens when a staff member leaves?",
                "Your named service-provider admin adds and removes people. TM ANTOINE still approves new accounts. When you remove someone, our administrators are notified. Do that the day they leave.",
            ],
            [
                "Support contact and expected response if the portal is down during an active application?",
                "support@tmantoinelaw.com, primary contact Vernon Francis, mailbox shared with TM ANTOINE administrators. Target: within an hour, pending availability. If you can still sign in, Messages to Cindy McLean, Emmanuel McLean, Krishna Manru, or Vernon Francis is equally valid.",
            ],
        ],
        col_twips=[3600, 6840],
    )
    add_body(
        doc,
        "We would rather walk through any remaining point on a call than leave a gap on your file. The portal is how we work with you. Comfort using it is part of that work.",
    )

    add_title(doc, "What we ask of you after the webinar")
    add_bullets(
        doc,
        [
            "Name your service-provider administrator if you have not already.",
            "Connect an authenticator app on every account that will be used.",
            "Bookmark https://portal.tmantoinelaw.com and treat any other host as suspect.",
            "Use Bespoke AI for 'how does this screen work' questions.",
            "Use support@tmantoinelaw.com or Messages for faults, never for sharing codes.",
            "Keep this briefing with your compliance file.",
        ],
        numbered=True,
    )
    add_body(
        doc,
        "Thank you for reading this as carefully as you read a client's file. That is the standard we are holding the portal to.",
    )
