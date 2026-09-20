# Turning on VPN blocking: what to configure, and where

Written for whoever administers the portal's Laravel Cloud environment and,
if the firm ever owns one, its Cloudflare zone. The code is already deployed;
everything here is configuration outside the repository.

**Nothing on this page is required for VPN blocking to work.** The
hosting-range check and Tor detection run with no setup at all. Read the next
section before doing anything: on the current DNS arrangement only one of the
three steps is actually available to the firm.

---

## First: whose Cloudflare is this?

Checked on 20 Sep 2026, and it matters more than anything else on this page.

- `tmantoinelaw.com` uses **Network Solutions / register.com** nameservers
  (`dns101.register.com`, `dns102.register.com`).
- `portal.tmantoinelaw.com` is an **A record to `103.133.1.1`**, which ARIN
  shows as `OrgName: Laravel`, not a Cloudflare range.
- Responses nonetheless come back with `server: cloudflare`, a `cf-ray` and a
  `__cf_bm` cookie.

So the portal **is** behind Cloudflare, but it is **Laravel Cloud's
Cloudflare account, not the firm's**. There is no zone for this domain in a
Cloudflare dashboard the firm can log into, because the domain is not on
Cloudflare nameservers at all.

**What follows from that:**

- Steps 1 and 2 below — managed transforms and WAF custom rules — are
  configured per zone by the zone's owner. The firm cannot do either on the
  current setup. They are written down for if the domain is ever moved onto
  the firm's own Cloudflare account.
- **Step 3 is the one that is actionable today**, and it happens entirely in
  Laravel Cloud's environment variables.
- `CF-IPCountry` **does** reach the application — every production sign-in in
  `auth_events` carries a country (LC, CA, AE, …). So country rules and Tor
  detection work right now, unchanged. Laravel Cloud's edge passes that
  header through.

If the firm wants steps 1 and 2, the prerequisite is moving DNS for
`tmantoinelaw.com` from Network Solutions to a Cloudflare account the firm
controls, and pointing the portal at Laravel Cloud through it. That is a
migration with real risk to mail and every other record on the domain, and
it should not be undertaken for VPN detection alone.

---

## Before you start: what the portal already does

With the **Refuse VPNs, proxies and Tor** toggle on (Account settings ›
Security › Security Policy), four signals are consulted in order, and the
first that fires refuses the request:

| Signal | Available today? | Catches |
|---|---|---|
| Tor (`CF-IPCountry: T1`) | **Yes** — header already arrives | Tor exit nodes |
| Hosting ranges | **Yes** — built in, no setup | Most commercial VPNs |
| IP reputation | **Yes**, via step 3 | Residential proxies |
| `CF-Anonymiser` | No — needs the firm's own zone (step 2) | Whatever rule you write |
| `cf-bot-score` | No — own zone + Enterprise (step 1) | Automated traffic |

The honest summary: **the two signals that need no configuration are already
working, and step 3 is the only one the firm can add today.** Between them
they cover Tor, the commercial VPN brands, and residential proxies.

---

## Step 1 — Bot protection headers (not available on the current setup)

**Requires the firm to own the Cloudflare zone — see above. On the current
Network Solutions + Laravel Cloud arrangement this cannot be done.**

It also requires an **Enterprise plan with Bot Management**; granular bot
scores are not available on Free, Pro or Business.

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

## Step 2 — A WAF rule that states the verdict (needs the firm's own zone)

**Same prerequisite as step 1: this is configured in the Cloudflare dashboard
for a zone the firm owns, which does not exist today.**

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

## Step 3 — IP reputation (actionable today, and the only step that is)

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
