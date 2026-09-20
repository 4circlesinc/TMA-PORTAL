# Turning on VPN blocking: what to configure, and where

Written for whoever administers the portal's Cloudflare zone and its Laravel
Cloud environment. The code is already deployed; everything here is
configuration outside the repository.

Nothing on this page is required for VPN blocking to work. The hosting-range
check and Tor detection run with no setup at all. These steps add accuracy,
and each is independently optional.

---

## Before you start: what the portal already does

With the **Refuse VPNs, proxies and Tor** toggle on (Account settings ›
Security › Security Policy), four signals are consulted in order, and the
first that fires refuses the request:

| Signal | Needs setup? | Catches |
|---|---|---|
| Tor (`CF-IPCountry: T1`) | No — already arriving | Tor exit nodes |
| `CF-Anonymiser` | Optional, step 2 | Whatever rule you write |
| `cf-bot-score` | Optional, step 1 (Enterprise) | Automated traffic |
| Hosting ranges | No — built in | Most commercial VPNs |
| IP reputation | Optional, step 3 | Residential proxies |

So the honest summary: **you get most of the value with no configuration.**
Step 3 is the one that adds genuinely new coverage.

---

## Step 1 — Bot protection headers (Enterprise plans only)

This is the "managed transform" route. It requires an **Enterprise plan with
Bot Management**; granular bot scores are not available on Free, Pro or
Business, so if you are not Enterprise, skip to step 2.

1. Cloudflare dashboard → select the `tmantoinelaw.com` zone.
2. **Rules** → **Settings** → **Managed Transforms**.
3. Enable **Add bot protection headers**.

That sends `cf-bot-score` (1 = certainly automated, 99 = certainly human),
plus `cf-verified-bot`, `cf-ja3-hash` and `cf-ja4`, which the portal ignores.

The portal refuses only a score of **5 or below**. That is deliberately
strict-but-narrow: a person on a corporate VPN is not a bot, and treating a
middling score as one would refuse ordinary clients in numbers. This signal
is here for scripted abuse, not for second-guessing people.

While you are on that screen, confirm **Add visitor location headers** is
enabled — that is what sends `CF-IPCountry`, which both the country rules and
Tor detection depend on. If geo-blocking has been working, it is already on.

---

## Step 2 — A WAF rule that states the verdict (any plan)

`CF-Anonymiser` is the portal's own header, not a Cloudflare one. It exists
so you can express "this is a VPN" using whatever fields your plan actually
has, without the portal needing to know what those are.

1. Cloudflare dashboard → zone → **Security** → **WAF** → **Custom rules**.
2. **Create rule**, name it something like `Flag anonymisers to origin`.
3. Write the expression for what you consider an anonymiser. On Enterprise
   with Bot Management, for example:

   ```
   (cf.bot_management.score lt 10) or (ip.src.is_tor)
   ```

   On lower plans you have fewer fields; use what your plan exposes (ASN
   lists, country, IP lists you maintain).
4. Action: **Skip** → and under **Modify request header**, add:
   - Header name: `CF-Anonymiser`
   - Value: `vpn`

The portal treats `1`, `true`, `vpn`, `proxy`, `tor` or `yes` as a refusal,
case-insensitively. Anything else is ignored.

**Do not use `cf.threat_score`.** Cloudflare removed it from the dashboard in
March 2025 and expects to disable the remaining rules during 2026. The portal
still reads `CF-Threat-Score` so that an edge already configured for it keeps
working, but do not build anything new on it.

### Test it before you rely on it

Set the rule to **Log** rather than Skip first, watch **Security Events** for
a day, and check what it would have caught. A rule that fires on your own
staff is much cheaper to find in a log than in a support call.

---

## Step 3 — IP reputation (the one that adds new coverage)

This catches residential proxies, which look exactly like home broadband and
which none of the other signals can see.

### Choose a provider

- **IPQualityScore** — `IP_REPUTATION_DRIVER=ipqualityscore`. Free tier
  around 5,000 lookups/month, which is far more than this portal needs.
- **ipapi.co** — `IP_REPUTATION_DRIVER=ipapi`. Simpler, less specialised.

Given roughly 24 distinct client addresses and a 24-hour cache, expect on the
order of tens of lookups a day, not thousands.

### Set the variables

Production runs on **Laravel Cloud**, so these go in the Cloud dashboard, not
in a file:

1. Laravel Cloud → your application → **Environment**.
2. Add:

   ```
   IP_REPUTATION_DRIVER=ipqualityscore
   IP_REPUTATION_KEY=<your key>
   IP_REPUTATION_TIMEOUT=2
   IP_REPUTATION_CACHE_HOURS=24
   ```

3. Deploy (or restart) so the new environment is picked up.

For local work, the same keys go in `.env`; they are already listed in
`.env.example`.

### It cannot take sign-in down

Worth knowing before you add a paid dependency to the login path: no key, a
timeout, a 500, a rate-limit or an unrecognised response all mean "no
verdict", and the decision falls back to the free signals. "We could not
check" is never treated as "this is a VPN". That behaviour is covered by
tests, including all three failure shapes.

The timeout is 2 seconds and verdicts cache for 24 hours, so one address
costs one lookup a day rather than one per request. A country refusal
short-circuits before any lookup happens, so blocked-country traffic never
costs you a paid call.

---

## Turning it on

Once the pieces you want are in place:

1. Account settings → **Security** → **Security Policy**.
2. Scroll to **Geographic restrictions**.
3. Turn on **Refuse VPNs, proxies and Tor**, set the message, **Save**.

If your own connection reads as an anonymiser, the save is refused and tells
you what it detected. That guard is the only thing standing between an
administrator and a lockout, because there is no allowlist.

---

## When a real client is refused

This will happen. Detection is inference, and there is no exception list, so
a client on a corporate VPN or iCloud Private Relay will eventually be turned
away with no way for you to let them through.

The audit trail is the only diagnostic:

```
grep vpn_blocked storage/logs/security.log
```

Each entry carries the address, which signal fired, the path and the user id
if they were signed in. On Laravel Cloud the same records go to the log
stream, and to Papertrail or Slack if `LOG_SECURITY_PAPERTRAIL` /
`LOG_SECURITY_SLACK_WEBHOOK_URL` are set.

Your options for a wrongly-refused client are: ask them to disconnect, or
turn the toggle off. If this becomes a regular occurrence, an allowlist is a
small change to make — it was left out because you asked for no exceptions.

---

## What none of this achieves

A residential-proxy service looks identical to a home broadband connection.
With step 3 configured you will catch many of them; without it you will catch
none. Either way, somebody determined to get around this will.

Treat VPN blocking as policy enforcement against ordinary users and as
evidence that the firm applies the control. It is not a security boundary,
and it does not reduce what authentication, MFA and the permission model are
doing.
