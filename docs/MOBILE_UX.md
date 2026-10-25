# Phone workflow and keyboard improvements

25 October 2026. This follow-up addresses having to scroll to reach the current
task or its action in the bill workflow. No deployment was performed.

## Changes

- Reduced oversized headings, duplicate instructions, decorative panels and repeated
  bill summaries on phones. The header keeps the current stage visible while typing.
- Anchored the current action inside the visible screen above the keyboard:
  Next, Continue, Add item, item editing, per-item sharing, Download and Done.
- Placed Add quantity beside Add item in the phone action bar. Both stay reachable
  while typing. The bill total remains visible without scrolling to a separate card.
- Added useful keyboard actions: Enter advances from bill name to people; Enter adds
  a person; Next moves item name to price; Done submits the item. Editor Next moves
  through name/price/quantity. VAT/discount Done dismisses the keyboard.
- Added a labelled Hide keyboard button. Retained 16px input text to avoid the usual
  small-input zoom behavior on iOS.
- Kept the compact layout during keyboard closing. It no longer expands immediately
  on input blur and risks moving a button between touch-down and click.
- Scrolls the active input into the actual space between the header and action bar.
  Changes such as errors or optional fields also recheck that space.
- Displays phone errors beside the current action, instead of below a long list.
- Uses a compact editor with Delete/Done pinned below it. Unrelated composer controls
  are hidden while editing and restored afterwards.
- Removed the redundant add-another-item panel from scan review on phones. The Add
  item tab still opens entry. Receipt review and editing are closer to the top.
- Uses two-column participant choices and a compact summary. Long lists still scroll;
  the action buttons stay outside that scrolling content.

Desktop forms retain their original input and action arrangements.

## Phone test coverage

`tests/browser/mobile-steps.spec.js` adds 11 scenarios:

| Scenario | Screen / visible height with simulated keyboard |
| --- | --- |
| Complete name → people → manual items → quantity → edit → VAT/discount → sharing → summary | 320×568 / 260px |
| Same complete workflow | 375×667 / 340px |
| Same complete workflow | 390×844 / 430px |
| Each complete workflow above runs with both layout-resizing and visual-viewport-only keyboard geometry | 6 scenarios total |
| Crop and mocked OCR review | All 3 phone screens |
| 20 people followed by landscape rotation | 375×667 → 844×390 |
| Duplicate-name validation and recovery above the keyboard | 320×568 / 260px |

Reachability checks assert full control bounds inside the visible area, no footer
occlusion using hit testing, and focused inputs inside the scrolling body. These
checks run before tapping the main action, so Playwright's automatic scrolling does
not hide the issue under test. The visual-viewport simulation also pans by 24px
while editing to check the phone overlay's offset handling.

The existing 36 browser scenarios also run, covering saved-data compatibility,
rounding, OCR errors, accessibility, desktop/tablet layouts and history behavior.
Screenshots are written for people entry, item entry, options, sharing, summary and
receipt crop. The keyboard screenshots show the application viewport; they do not
depict a real operating-system keyboard.

## Verification and limits

Passed for this follow-up: **47 browser scenarios** (11 new phone scenarios plus
the existing 36), **26 unit/API/HTTP checks**, **ESLint** and a **production build**.
The final browser run completed in approximately 1 minute 24 seconds with no failed,
skipped or flaky scenarios; machine-readable results are in `test-results/browser.json`.
The 320px summary also checks that all three participant totals fit above the
action bar. Phone screenshots were visually reviewed alongside the geometry tests.

The keyboard tests simulate browser geometry in touch-enabled Chromium. They do not
open native iOS/Android keyboards or certify every Safari/Android version, keyboard
extension, system font size or browser toolbar configuration. A physical-device
check remains advisable before deployment. Extremely small viewports and long lists
can require scrolling to read content; the current action remains pinned.

All external OCR responses are mocked, and history fixtures use isolated browser
contexts. No real receipts, accounts, API quotas or user storage are used.

Run: `npm run build`, `npm test`, `npm run lint`, `npm run test:e2e`.
