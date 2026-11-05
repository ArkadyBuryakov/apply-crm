# 0035. Phone layout and home-screen install

- Status: Accepted
- Date: 2026-11-05

## Context
The SPA was built for desktop. On a phone the sidebar kept a 56 px rail, the board relied on HTML drag-and-drop (which
touch screens do not fire), dialogs were boxes the keyboard covered, inline edit buttons only appeared on hover, and
14 px inputs made iOS zoom in on focus. The desktop layout should stay exactly as it is.

## Decision
- **One app, one set of routes.** Below Tailwind's `md` (768 px, `PHONE` in `lib/media.ts`) the same pages switch to a
  phone shell through responsive classes, plus a few phone-only components behind `usePhone()`. Tablets keep the rail.
- **Shell.** The sidebar is hidden; a bottom tab bar holds Pipeline, Agenda, Search and Assistant, and More opens a
  sheet with the remaining pages, project switch, theme and account. The header shows the page title, or on detail
  pages a way back to their list (browser history when there is one, so an installed app without a back button works).
  List pages pass `phoneTitle={false}` to `PageHeader`, which keeps their `h1` for screen readers only.
- **Dialogs** are full screen below `sm`, with the footer pinned; widths passed by callers are `sm:` prefixed.
- **Touch.** Inputs are 16 px below `md`; buttons, inputs and menu items grow on `pointer: coarse`; hover-only controls
  show on touch screens. Each page's main create action becomes a floating button (`Fab`).
- **Pipeline** on phones lists one stage at a time, picked with chips; each card moves with a stage picker.
- **View-only on phones:** the action graph pans, zooms and opens actions but does not drag or link (linking stays in an
  action's menu); documents show and download versions but do not edit LaTeX, and open PDFs in a new tab because
  mobile browsers do not show them inline.
- **Install.** A web app manifest, icons (`public/`, generated from `favicon.svg`) and Apple meta tags make the app
  installable with `display: standalone`; `theme-color` follows the app's theme. There is no service worker: the app
  needs the server, and Chrome no longer requires one to install.
- **Tests.** Playwright runs a `phone` project (Pixel 7) after `desktop`, with `e2e/phone.spec.ts`; the screenshot spec
  captures both.

## Consequences
- New pages must be checked at phone width; fixed widths in headers and forms need a `max-md:` fallback.
- No offline use and no push notifications; either would need a service worker.
- iOS ignores `interactive-widget=resizes-content`, so on iPhones the keyboard can still cover the bottom of a
  full-screen dialog until the field scrolls into view.
