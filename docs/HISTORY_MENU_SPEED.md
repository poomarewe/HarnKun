# Faster history detail menu

25 October 2026. Local implementation; no deployment performed.

## Behavior

- The three layers slide for 160 ms each, starting at 0, 20 and 40 ms.
  The complete opening timeline is 200 ms, down from 760 ms (140 + 620 ms).
- Closing reverses the order: panel at 0 ms, middle at 20 ms, back at 40 ms.
- The backdrop fades for 160 ms and becomes hidden after 200 ms on close.
  Its transition overrides the theme's general button transition. The menu
  icon also finishes within the same timeline.
- Focus moves into the panel on the next rendered frame with `preventScroll`,
  replacing the fixed 360 ms timer. Closing cancels any pending focus frame.
- Reduced-motion preferences remove delays and make all menu transitions
  effectively instant, including the toggle itself.

## First opening and recovery

When saved history appears, the application starts loading the three existing
style files. Card pointer interaction and keyboard focus also warm them up.
Stylesheets download together, with links inserted in their original cascade
order. One cached promise is shared by warmup, opening and the bill workflow.

The loader owns its stylesheet links so failed loads can be removed and retried;
it does not retain a rejected dynamic-import preload. Background errors are
caught. If an explicit history opening fails, the card remains available with
a retry message. A successful tap clears that message without clearing any
existing saved-data warning. No history data or storage schema is changed.

## Verification

`tests/browser/history-menu.spec.js` adds eight browser scenarios with motion
enabled by default. They cover 320×568, 375×667, 390×844 and 1440×900 screens,
first opening, cached reopening, keyboard activation, prompt focus without
scrolling, Escape, backdrop/toggle closing and interrupted transitions.

The checks inspect computed durations and delays, including the backdrop's
actual transition properties, and wait for browser animations to finish.
Observed completion allows up to 100 ms beyond the 200 ms CSS timeline for
browser frame scheduling. Visibility alone is not used as proof of completion.
Separate scenarios cover reduced motion, gated cold downloads, failed background
and explicit loads followed by retry, QR sharing, image export and editing.
The existing regression suite retains coverage of swipe deletion and saved bills.

Passed: all **55 browser scenarios**, **26 unit/API/HTTP checks**, lint and the
production build. After the final timing-only selector adjustment, all eight
history scenarios passed again, including phone control-position assertions.
Both browser runs had zero failed, skipped or flaky tests. The full report is
`test-results/browser.json`; the final focused report is
`test-results/history-final.json`.

Final observed completion times (milliseconds, including browser scheduling):

| Screen width | Open | Close | Reopen | Initial focus |
| --- | ---: | ---: | ---: | ---: |
| 320px | 237 | 213 | 249 | 22 |
| 375px | 247 | 233 | 216 | 18 |
| 390px | 237 | 237 | 216 | 22 |
| 1440px | 247 | 248 | 231 | 16 |

Phone and desktop screenshots were visually reviewed. Temporary test servers
were shut down after verification.

The 200 ms target starts when the drawer opens with styles ready. Network delay
before a first uncached opening is measured separately; it is not a network SLA.
Phone testing uses Chromium viewports rather than physical iOS/Android devices.
