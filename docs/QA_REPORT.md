# Harn.fun QA, security and reliability report

Phone usability follow-up: see [MOBILE_UX.md](MOBILE_UX.md) for the later compact
workflow, keyboard handling and additional phone-specific regression coverage.

History menu speed follow-up: see [HISTORY_MENU_SPEED.md](HISTORY_MENU_SPEED.md)
for the 200 ms drawer timeline, style warmup and animation-enabled checks.

25 October 2026 (Asia/Bangkok). Baseline commit:
`315bb29a046c4dce1595df2288d197cbcb0f875e`.

The repository was inspected before application changes. The baseline production
build passed; no test or lint scripts existed. Higher-risk repairs were implemented
only after the owner explicitly approved the proposed calculation, persistence,
privacy, API-hardening and compatible dependency changes in this chat.

## 1. Project architecture

- React 19.2.8, JavaScript/JSX, Vite (8.1.5 initially, 8.3.5 after patching),
  Express 5.2.1. No TypeScript project or TypeScript checks apply.
- `/`, `/history?r=...`, `/admin`; Vercel configuration is present, with a 60-second
  scan function limit. Actual Vercel deployment settings were not accessed or changed.
- Public bill splitting requires no login. An existing admin password/session
  protects visitor analytics. No public-user authentication was added.
- Completed bills use IndexedDB database `harn-kun-history`, version 1,
  store `operations`, primary key `id`. Schema and saved bill fields remain compatible.
  No real data was reset, deleted or migrated. Corrupt rows are retained but skipped
  during rendering with a visible warning. Theme uses a guarded localStorage write.
- Drafts and receipt object URLs live in memory; drafts do not survive reload.
  Saved history does not contain receipt photos. Sharing serializes bill details
  into a gzip/base64url v1 URL; legacy uncompressed v1 links remain supported.
- Neon Postgres stores visitor UUIDs, activity dates and admin login attempt counters.
  A one-year HttpOnly visitor cookie and 45-second visible-page heartbeat support
  the admin dashboard. This is additional server-side data collection, despite
  the public workflow having no registration.
- Typhoon OCR is server-only. The scan path normalizes images through Sharp and
  sends JPEGs to `https://api.opentyphoon.ai/v1/chat/completions`.
- QRCode, fflate, canvas PNG export, optional iOS native sharing, Vercel Speed Insights
  and locally bundled Mali fonts complete the runtime integrations.

The original `/api/operations` request transmitted bill names, friends, line items,
assignments, payments and raw OCR to a server logging endpoint. That request has
been removed from the public workflow, and the retained compatibility endpoint no
longer logs bill contents. Manual calculation and saving work offline after loading.

The precise rounding policy, examples and old-record behavior are documented in
[BILL_ROUNDING.md](BILL_ROUNDING.md). Legacy saved discrepancies are not silently rewritten.

## 2. Feature coverage

The complete discovered controls/checklist are in [QA_FEATURES.md](QA_FEATURES.md).
“Pass” below refers to executed scenarios, not every permutation of the common matrix.

| Inventory ID | Feature | Executed result / remaining boundary |
| --- | --- | --- |
| F01 | Home/create/intro | Pass: home and empty-state availability, create and responsive workflows. Intro included in lab load measurement; reduced-motion browser tests. |
| F02 | Name/back/close/resume | Pass: blank name blocked, close/resume retains draft, refresh starts a fresh draft. Back/forward exercised on shared routes; drafts intentionally do not navigate as routes. |
| F03 | People | Pass: add/remove, blank, case-insensitive duplicate, one-person blocked, 100-person UI limit. |
| F04–05 | Manual items/editor/delete | Pass: zero, decimal, duplicate items, quantity edit, add/edit/delete, negative edited price blocked. Unit calculations cover 1,000 items. Not every large-list interaction was profiled. |
| F06 | VAT/discount | Pass: normal VAT/discount workflow, fractional VAT regression, zero/full-discount calculation checks and seeded randomized allocation. |
| F07–08 | Images/crop | Pass: synthetic upload, crop confirm/aspect, corrupt image recovery, EXIF-rotated/blurred/large image optimization through mock provider. Physical camera capture, drag/pinch geometry and every device codec are not certified. |
| F09 | OCR/cooldown | Pass: mocked Thai table, non-receipt/empty output, 429/500/network/timeout recovery, manual fallback, cooldown and same-IP concurrency. No real OCR recognition-quality test was run. |
| F10 | Sharing assignments | Pass: subset assignment, select/clear all, previous item, no-selection disabled, integer remainder conservation. Weighted splits do not exist. |
| F11 | Summary/export/done | Pass: sum conservation, clean completion, real PNG download and QR navigation. Physical iOS share sheet and extremely large exports remain untested. |
| F12 | History/persistence | Pass: original-format fixture, refresh, isolated browser close/reopen, four sorts, separate-browser isolation, cross-tab update, stale-write rejection. |
| F13 | Swipe delete | Pass: release cancels, hold completes, only fixture removed, refresh retains remaining fixture. |
| F14 | Clear confirmation | Pass: cancel preserves fixtures, confirm clears fixtures, reload empty. Only synthetic browser data was cleared. |
| F15 | Drawer/edit | Pass: open, edit same record ID without duplication, download/QR access, closed drawer made inert. |
| F16 | Shared links/QR | Pass: compressed and legacy links, Thai text, invalid/missing/oversized payload, escaped HTML-shaped title, read-only detail. Very large QR payloads remain a known limitation. |
| F17 | Network/mobile | Pass: offline manual completion and reconnect notice; no page/dialog horizontal overflow at 320/375/390/768/1440. Screenshots captured. Real mobile keyboards, OS gestures and Safari are not certified. |
| F18 | Admin | Pass: mocked sign-in/dashboard/refresh/logout; failed logout warning; signed/tampered/expired session helpers, cookie flags and origin rejection. Live Neon SQL, real successful admin login, lockout races and 30-second polling expiry not integration-tested. |
| F19 | Hidden brand action | Source-confirmed: clicking the Harn Kun heading writes a random history record. Retained to avoid removing an existing behavior; not included in automated workflow coverage. |
| F20 | Metadata/assets | Pass: built routes, manifest, icons, robots and sitemap via actual local HTTP. No service worker exists; cold offline loading/install behavior is not promised. |

## 3. Bugs discovered and disposition

| Severity | Reproduction and impact | Affected files / repair |
| --- | --- | --- |
| High | Add ฿2.50 and 7% VAT. Summary/history displayed ฿2.67 while final allocations summed to ฿2.68. | `src/main.jsx`, new `src/money.js`, sharing view. Fixed with one rounded integer-satang total and exact integer proportional remainders. |
| High | Edit a positive line total to a negative value, press Done, continue. HTML `min` outside form submission did not validate it. | `src/main.jsx`. Fixed validation before sharing; normalize accepted prices to satang. |
| High | Scan a receipt, wait cooldown, replace it with a scan that fails. Existing line items and assignments disappeared. | `src/main.jsx`. Existing data now remains until a replacement returns usable items. |
| High | Simulate IndexedDB quota failure during completion. Summary claimed the bill was saved; nothing persisted. | `src/main.jsx`, `src/history-store.js`, `src/GuidedWorkflowView.jsx`. Visible warning, unsaved description, retry and download remain available. |
| High | Put a row containing only `id` and `updatedAt` in the isolated history store, reload. Rendering threw on missing fields and blanked the app. | `src/history-store.js`. Validate before rendering, retain original bad row, warn. |
| High | Edit the same bill in two tabs; finish the newer edit, then finish the stale edit. Original code silently overwrote it. | `src/history-store.js`, `src/main.jsx`. Atomic read/compare/write transaction rejects a stale `updatedAt`; BroadcastChannel/focus refresh keeps lists current. |
| High | Complete a manual bill offline; original mandatory logging request failed before local save. It also unnecessarily transmitted private bill details. | `src/main.jsx`, `api/operations.js`, `server.js`. Removed client request; retained endpoint validates without receipt logs. |
| High | Start two same-IP OCR requests concurrently. Both could pass the check before asynchronous form parsing finished. | `api/scan-bill.js`. Recheck/reserve after parsing, before processing; regression proves only one mock provider call. This does not solve cross-instance limits. |
| Medium | Corrupt image with `image/png` MIME opens crop; image never loads and preparing state never resolves. | `src/GuidedWorkflowView.jsx`. Decode error closes crop with recovery message; existing bill remains. |
| Medium | `%` in an unrelated cookie throws `decodeURIComponent` before admin/analytics error handling. | New `lib/cookies.js`, auth/visitor helpers. Ignore malformed cookie values safely. |
| Medium | POST JSON `null` or null items to operations. Unchecked dereferences threw instead of a validation response. | `api/operations.js`, `api/admin-login.js`. Shape/type checks and controlled JSON errors. |
| Medium | Upstream throttling, timeout and network failure were all returned as 422; upstream error details were reflected and logged. | `api/scan-bill.js`. Distinct 429/503/504/502/415 responses, Retry-After, safe messages, upload/pixel limits, expiring bounded instance map; browser deadline and in-flight guard. |
| Medium | Network failure during logout switched the UI to sign-in although the cookie could remain valid. | `src/AdminPanel.jsx`. Stay on dashboard with explicit warning and retry. |
| Medium | Shared gzip bytes were decompressed without an application bound. Trailer-controlled allocation could be excessive. No destructive allocation test was attempted. | `src/main.jsx`. Bound encoded/decoded sizes, fixed output allocation, validate structure/numbers/names. |
| Medium | Browser zoom was disabled globally; modal Tab could escape to background; two shared labels failed contrast. | `index.html`, `src/main.jsx`, `src/useDialogKeyboard.js`, `src/maggie-workflow.css`. Restore zoom, trap modal keyboard focus/Escape, darken two labels. |
| Low | Create/resume accessible label did not contain the visible button text; hidden history controls could remain keyboard-focusable. | `src/main.jsx`, `src/StaggeredMenu.jsx`. Use visible text as button name and inert closed drawer. |
| Security advisories | Initial audit: 9 vulnerable packages (1 critical, 6 high, 2 moderate). Application-specific exploitability was not demonstrated for every advisory. | `package-lock.json`: compatible updates; final npm audit returned zero known vulnerabilities. |

The critical dependency advisory was for proxy-addr, with applicability depending on
the trust configuration; updating the dependency does not prove the app had an
exploitable trust bypass. See the [maintainer advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h).

## 4. Fixes and tests added

- `src/money.js`: integer satang conversion, safe input bounds and exact tax/share helpers.
- `src/history-store.js`: existing IndexedDB schema extracted into guarded transactions,
  malformed-row filtering, cross-tab notifications and conflict detection.
- `src/main.jsx`: use helpers, preserve scan data, validate edits, remove logging request,
  save warning/retry state, bound shared decoding; remove global zoom suppression.
- `src/GuidedWorkflowView.jsx`: correct per-item remainder display, accurate saved state,
  retry saving, invalid image recovery. `src/useDialogKeyboard.js`: modal keyboard behavior.
- `src/StaggeredMenu.jsx`, `src/maggie-workflow.css`, `index.html`: targeted accessibility fixes.
- `api/scan-bill.js`: upload and image limits, race guard, safe errors and timeout handling.
  `server.js` now uses the same OCR and operations handlers locally, removing divergent
  duplicate implementations; unknown API endpoints return JSON 404.
- Cookie helpers, operations/login validation and admin logout were hardened.
  Analytics/admin server errors now log generic failures without raw exception objects.
- `tests/core.test.js`, `tests/ocr.test.js`, `tests/integration.test.js`,
  `tests/browser/workflows.spec.js`: repeatable unit, handler, HTTP and browser coverage.
- `playwright.config.js`, `eslint.config.js`, package scripts and development-only
  Playwright/axe/ESLint dependencies. No runtime dependency was added.
- `scripts/qa-benchmark.js`: bounded, fixed-localhost static load and mobile lab measurement.
- `.gitignore` ignores generated test reports and local npm cache. No deployment or
  production configuration was changed; `vercel.json` is unchanged.

## 5. Security findings and remaining risks

### Confirmed in local code/tests

- **Shared provider protection is absent.** A mock diagnostic sends three independent
  client requests through two handler instances and observes three provider calls.
  Per-IP memory cooldowns do not coordinate instances or enforce an API-key-wide rate.
  Browser refresh resets the UI timer; the server timer survives only within its
  current instance. Shared NAT users also share a cooldown, so “per user” is approximate.
- **The provider has two documented limits:** 2 requests/second **and 20/minute** for
  typhoon-ocr. Both need global enforcement, ideally rejecting/queuing before expensive
  image work. Account-specific entitlements were not checked. [Typhoon rate limits](https://docs.opentyphoon.ai/en/rate-limits/)
- Bills are intentionally embedded in share URLs. Anyone with the QR/link can read
  them; links are neither encrypted nor signed. Query payloads can enter browser
  history and hosting logs. Consider new fragment-based links with backward-compatible
  query support plus a no-referrer policy in a separately approved privacy change.
- Anonymous analytics accepts public writes and has no application rate limit or
  retention purge. Bot traffic may inflate counts and database usage. This was not
  stress-tested against a real database.
- Repository Vercel headers cover robots directives only; no CSP, framing policy,
  nosniff or explicit Referrer-Policy is configured there. Actual production headers
  may be supplied by hosting and were not verified.

### Positive checks and limits of assurance

- API key references are server-side. A build test compares private local configuration
  values against browser bundles without printing the values; none were found.
  `.env` is ignored and not tracked in the current checkout. Full Git history was not audited.
- No `dangerouslySetInnerHTML`, evaluated user code or active insertion of OCR HTML
  was found. Shared HTML-shaped names render as React text; no script executed in
  the tested payload. This is sampled XSS coverage, not a proof of absence.
- Admin cookies have HttpOnly, SameSite=Strict and HTTPS Secure flags, signed expiring
  sessions and password digest comparison. Login failure tracking exists in Neon,
  but real DB races, credential policy and deployment proxy trust were not tested.
- Forwarded address trust is hosting-dependent. Do not assume raw forwarded headers
  are reliable on arbitrary self-hosted deployments.
- Upload MIME alone is not trusted: Sharp decodes image bytes with a 40-million-pixel
  bound, supported raster formats and 4 MiB file limit. Request Content-Length is
  checked when supplied; application code still parses multipart before per-file
  checks. Hosting ingress limits remain relevant for unknown-length/abusive requests.
- The final advisory scan reports zero *known* vulnerabilities as of the audit; it
  does not establish that dependencies or the site are vulnerability-free.

## 6. Performance and scalability

Baseline Vite output: entry JS **294.31 kB / 90.82 kB gzip**; initial CSS **132.27 kB /
22.92 kB gzip**. Final output is approximately **299.23 kB / 92.75 kB gzip** for entry JS;
initial CSS remains unchanged. Workflow CSS totals roughly 181 kB uncompressed across
three lazy files. CSS is loaded sequentially, adding round trips on slower networks.

A measured local run scheduled **500 static HTML requests at 100/s for five seconds**:
all 500 returned 200, achieved 100.06/s, median 1.49 ms, p95 2.48 ms. This only measures
the local Express HTML path. It does not validate Vercel capacity, sustained traffic,
CDN behavior, database capacity, image processing or OCR throughput.

A single cold mobile lab run (390×844, Chromium, 4× CPU, 150 ms latency, 1.6 Mbps,
local uncompressed Express serving) measured **FCP/LCP 3.036 s**, **CLS 0.0035** and
about **488 kB transferred**. These are lab observations, not field Core Web Vitals.
INP and long-session memory behavior were not measured. Final benchmark evidence is
generated in `test-results/performance.json`; values may vary with machine load.

Confirmed pressure points: visible-page heartbeats perform two SQL upserts every
45 seconds; QR cache never evicts; history loads all rows and renders the full list;
large PNG exports and QR capacity are unbounded by the display layout. These were
reviewed in code, not demonstrated as production bottlenecks. Native mobile image
decoding happens before server limits and still merits device testing.

Vercel documents a 4.5 MB function body limit, including multipart overhead; the
client targets 3.8 MiB when compressing, and server per-file size is 4 MiB. Actual
ingress rejection and the existing 60-second function budget require staging checks.
[Vercel function limits](https://vercel.com/docs/functions/limitations)

## 7. Test results and reproducibility

Final application checks: **26 unit/handler/HTTP tests passed**, **36 browser tests
passed**, **ESLint passed**, **production build passed**, and **npm audit reported
0 known vulnerabilities**. No final functional test failures remain in these suites.
One passing diagnostic intentionally demonstrates that global OCR protection is
missing; its pass is evidence of the remaining risk, not a security-control pass.
The 1,000 seeded calculation cases are included in one unit test, not counted as
1,000 separate test results. Axe scans reported zero violations on home, shared
receipt and admin login, and zero serious/critical violations in the bill dialog.

Run on Windows with Node 25.8.0 and matching Playwright Chromium. Development
accessibility tooling requires Node 22.12+; use a supported Node version in CI.

```text
npm ci
npx playwright install chromium
npm run build
npm test
npm run lint
npm run test:e2e
node scripts/qa-benchmark.js
npm audit
```

Browser/HTTP servers use dedicated localhost ports 4174–4176, dummy/unset secrets,
and a nonexistent dotenv path. Real OCR and analytics calls are disabled or mocked.
The default browser suite uses fresh contexts, with one dedicated temporary profile
for close/reopen testing. It does not open the user's browser profile.
`scripts/qa-e2e.js` owns the test server directly so Windows teardown does not
depend on terminating a shell's descendant process tree.

Screenshots include bill/summary/shared layouts at all five requested widths and
the exported PNG. Browser JSON results and failure traces live under `test-results/`.
The final browser run completed in 59.8 seconds with 36 expected passes, zero skipped,
zero unexpected failures and zero flaky tests. Representative 320px bill, 1440px
summary, 320px shared view and the exported PNG were visually inspected.
The local Speed Insights script is stubbed during browser tests because its Vercel
hosted endpoint is absent from Express. Actual Speed Insights delivery is not tested.
ESLint uses recommended core checks with JSX parsing; unused-variable checking is
disabled because core ESLint does not account for JSX component references. React
hook dependency linting is not configured.

## 8. Blocked / not executed

- A read-only attempt to open `https://harn.fun` through the web tool returned an
  accessibility error. No production browser audit or live response-header validation
  was completed; do not interpret local results as production verification.
- No real Typhoon requests: real recognition accuracy, blurry-photo quality,
  vendor-side quota behavior and billing were not tested. Synthetic images test
  processing and mocked responses only. Real API requests require separate authorization.
- No real Neon connection or SQL migration was made. Correct dashboard queries,
  daily timezone transitions and distributed admin lockout races remain unverified.
- No production load tests, intrusive attacks, real user-data changes, paid services,
  production configuration changes or deployments.
- Chromium viewport/context tests are not physical iOS/Android, WebKit/Firefox or
  all private-browsing implementations. Real software keyboards, camera permission
  denial, native share/download behavior and OS memory pressure need device QA.
- No process-kill-during-write stress test, 24-hour soak, complete accessibility
  certification, every possible input permutation or full historical data corpus test.

## 9. Before a TikTok / Instagram launch

1. **High: approve and implement global OCR admission control** for 2/s and 20/min,
   per-client abuse limits, bounded waiting and fail-closed store outages. Reuse the
   existing Neon database only if transactional latency/cost is acceptable, or approve
   another shared service explicitly. Add mocked multi-instance limit tests before
   connecting the real store. Do not advertise 100 OCR requests/s.
2. **High: deploy to staging only after approval**, inspect actual headers and function
   settings, validate forwarded client addresses, run one authorized real receipt and
   verify backend timeouts. Review analytics abuse protection and retention.
3. **Medium: improve share-link privacy** (fragment payload for new links, legacy query
   compatibility, no-referrer) and approve appropriate CSP/framing/nosniff deployment
   headers after testing existing fonts, image blobs/data URLs and Speed Insights.
4. **Medium: device QA**, especially Safari/iOS camera, crop gestures, software keyboards,
   native share, browser storage permissions and extreme export sizes.
5. **Medium: trim duplicate CSS / lazy-load admin**, bound QR cache, paginate large
   history lists, handle QR capacity failures with a user-visible export alternative.
   Measure on real devices before broader changes.
6. **Low: decide whether the heading's random-bill generator belongs in production**;
   it can add surprising fake history, but was retained to preserve discovered behavior.
   Consider an explicit draft-loss notice and plain-language data/retention explanation.

The repaired local checks do not make the site bug-free or launch-ready while shared
OCR protection and production/device verification remain outstanding.
