# Verified feature inventory and QA checklist

Audit date: 25 October 2026. Source baseline: `git rev-parse HEAD` in QA_REPORT.md.
All automated scenarios use temporary browser contexts, synthetic receipts, dummy secrets,
and mocked external services. No real bills or production databases are used.

## Architecture and routes

- React 19 / JSX / JavaScript, Vite 8, Express 5 for local/standalone serving.
- Vercel configuration supplies six Web Request/Response API handlers and rewrites
  `/history` and `/admin` to the SPA. Deployment settings cannot be verified from code.
- `/`: home, intro animation, create/resume draft, recent bills, sort and clear.
- `/history?r=...`: gzip/base64url v1 receipt, plus legacy uncompressed v1 decoding;
  read-only bill, assignments, payments and create-home link. Missing/invalid link errors.
- `/admin`: password form, anonymous visitor counts, 30-day chart/table, refresh,
  30-second polling, logout and home links. Public bill workflows require no account.
- IndexedDB `harn-kun-history` version 1, store `operations`, key `id` saves completed
  bills. Drafts exist only in React memory. Receipt images are object URLs, not saved.
- localStorage `harn-kun-theme` is the only localStorage key. UI currently forces light.
- Neon Postgres stores visitor UUIDs, first/last seen, daily counts and login attempts.
  Visitor cookie lasts one year. Heartbeat runs every 45 seconds when visible.
- Typhoon receives optimized receipt JPEGs server-side. Vercel path: 4 MiB upload,
  1280px output, 55s timeout; Express path: 15 MiB upload, 120s timeout.
  After repair, Express delegates to the same 4 MiB / 55s production handler.
- Lazy CSS, fflate compression, qrcode generation, canvas PNG export, iOS file sharing,
  Vercel Speed Insights (query removed before sending) and local Mali font files.

## Discovered controls and behavior

| ID | Feature and interactive controls | Required checks |
| --- | --- | --- |
| F01 | Home intro, primary create/resume, empty-history create | desktop/mobile, repeated clicks, reduced motion |
| F02 | Bill name, next, back, close, backdrop; resume in-memory draft | empty/whitespace/max 80, refresh/navigation/interruption |
| F03 | Name form, add/remove chips, continue | 2–100 people; one blocked; blank; case-insensitive duplicate; max 60 |
| F04 | Type item, name/line total, add/hide quantity, photo alternative | blank/invalid/zero/decimals; quantity integer; duplicates |
| F05 | Inline item editor, done, delete; list | edit invalid amount/quantity; remove first/middle/last; many items |
| F06 | Bill options, VAT checkbox/rate, discount checkbox/baht | zero, negative, huge, 7%, fractional VAT, full/excess discount |
| F07 | Camera picker, upload picker, crop back/retake/choose again/confirm | empty/unsupported/corrupt/large/Thai/rotated receipt |
| F08 | Crop drag, two-pointer zoom, wheel zoom, aspect toggle | small viewport, bounds, failed image decode, keyboard access |
| F09 | OCR progress, cooldown, change photo, thumbnail/preview/close | mocked 200/empty/429/500/network/timeout, retry/concurrency |
| F10 | Per-item person selection, select/clear all, next/previous/back | no assignment blocked; subset splits; rounding; rapid clicks |
| F11 | Summary, each-person totals, download picture, done | sum equals displayed total; zero bill; download and clean next bill |
| F12 | Recent list: date groups, categories, initials, totals, four sorts | persistence, old schema, corrupt records, multiple tabs |
| F13 | Swipe left and hold 800ms to delete; cancel/release; input shield | temporary fixtures only; cancellation, single-record removal |
| F14 | Clear history and confirmation: cancel/Escape/backdrop/remove all | temporary fixtures only; no accidental deletion |
| F15 | History drawer open/close/backdrop/Escape, edit, export | focus/keyboard, roundtrip edit and overwrite ID |
| F16 | Receipt QR generate/enlarge/close/Escape/open link | v1/legacy, Thai/unicode, oversized/corrupt payload, XSS strings |
| F17 | Online/offline status; mobile viewport handling | offline recovery, mobile keyboards, no horizontal overflow |
| F18 | Admin loading/login/error/dashboard/refresh/logout | mocked login/rate limit/outage/session expiry; no live DB requests |
| F19 | Hidden brand heading action creates random saved bill | verify and flag surprising behavior; preserve pending decision |
| F20 | Manifest, icons, SEO/robots/sitemap/version footer | route availability; no service worker/offline install guarantee |

Unequal splits mean different participant subsets per item. Weighted/percentage
splits, service-charge control, payment collection and public-user accounts do not exist.
Quantity is informational; amount is the full line total, not a unit price.

## API checklist

| Endpoint | Behavior to cover |
| --- | --- |
| POST /api/scan-bill | methods; missing/empty/unsupported/oversized/bad multipart; image optimization; response parsing; timeout/network/429; per-IP cooldown; shared limit |
| POST /api/operations | malformed JSON/body/items; 2–100 people; numeric validation; sensitive logs; offline dependency |
| POST /api/analytics | method; UUID cookie; malformed cookies; setup/outage; no-store; retention/abuse risk |
| POST /api/admin-login | method; origin; config; password; shared DB lockout; cookie flags |
| GET /api/admin-dashboard | method; config; absent/tampered/expired session; DB unavailable; no-store |
| POST /api/admin-logout | method; origin; expired cookie; frontend failure recovery |

## Common matrix

For each applicable feature: happy path, empty/invalid/boundary input, rapid use,
refresh, browser back/forward, interruption, error recovery. Screens: 320, 375,
390, 768, 1440 CSS pixels. Check overflow, bounds, keyboard names/focus, readable
contrast, touch sizes and screenshots. Distinguish Chromium emulation from physical
iOS/Android verification. Final executed coverage and limitations are in QA_REPORT.md.
