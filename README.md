# The Sheet

(Formerly MultiTool.) An offline, installable shift tool: checklists, how-to cards, an assignment sheet, an inventory count with ordering, shift notes, a floor board with breaks, follow-ups, and plain-text messages for team chat.

**This repository holds no data.** It's an empty app. Content comes from private repositories that the app reads and writes through the GitHub API, with fine-grained tokens stored only on the phone. Phone-only things (shift notes, the floor board, trainees, message drafts, the staffing plan, the counts in progress) never sync. A backup file, saved by hand, holds the synced parts plus trainees and the counts in progress (one per room); it never holds the keys, shift notes, the floor board, message drafts, clash notes or the staffing plan (which comes only from its own phone-only file).

## Connections

- **Book** (one person): `book.json` and `state.json`: checklists, cards, the day, follow-ups, wins, the printed-copies log.
- **Inventory** (shared by everyone who counts and orders): `inventory.json` (lines, products, and what's flagged to order) and `counts.json` (saved counts, orders and their status). If no inventory connection is set, these two files sync to the book repo instead.
- **Training** (a team repo): `floorplans.json`, the floor plans, and `card3.json`, the allergen card. It has no fallback: until it's connected, both stay on the phone.

A phone with only an inventory connection runs in **count-only mode**: just the Count and More tabs.

Setup links: `#setup=owner/repo` prefills the book connection, `#setup=inv:owner/repo` the inventory one. On an iPhone, add the app to the Home Screen first and set up inside the installed app: its storage is separate from Safari's, and Safari may clear a tab's data after a week without a visit.

## Access

Access is managed on GitHub, not in the app. Each part of the app lives in its own private repo in the organization, and people get to parts through teams:

- Set the organization's base permission to **No permission**, so members see only what a team gives them.
- One team per job (for example, a team with **Write** on the inventory repo). Add **Read** for anyone who should only look.
- Keys for the organization use **All repositories**. A key only reaches what its owner has been given, so a new grant needs no new key.

Every sync asks GitHub what the key may do with each repo. Write: normal. Read: the part loads but nothing is sent, and the Count and floor plan screens go view-only. No access (removed from the team, or the key revoked or expired): that part stops syncing and says so. What's already on a phone stays there; removing access stops future syncing, it can't wipe a phone.

If a phone has unsent changes when its access drops to view only (say a count saved offline), they stay on the phone, unsent, and go up if write access comes back. Where someone else changed the same thing meanwhile, GitHub's version wins, so the late send can't undo it.

The data repos must stay private. If one is made public on GitHub, phones keep reading it but send nothing to it, and the sync status says why; changes wait on the phone until it's private again.

Synced files are tied to the repo's id, so renaming the repo or the organization doesn't restart anything. On a phone's first sync with a repo (a new phone, a restored backup), GitHub's copy wins any differences and anything only the phone has is added.

Adding a new part means a new repo, a new connection in `js/sync.js` and its screens; access to it then works the same way.

## Tests

`node tests/run-all.mjs` runs everything: sync between several phones against a fake GitHub, every screen drawing, the accessibility checks, print checks in a real Chrome (skipped without Chrome and Playwright for Python), and that app files never change without a new version. Node 20+, plus Python 3 with `lxml` for two of the accessibility checks. Details, and what the tests can't cover, in `tests/README.md`.

## Accessibility

Target: WCAG 2.2 level AA. Checked on 10/29/26 (1.4.0), by script (`tests/a11y`) and by reading the code, not yet with a screen reader on a phone:

- **Contrast (1.4.3, 1.4.11):** every text color on every background it's used on, in light and dark, is at least 4.5:1; form-field borders, the focus ring and the selected-tab mark are at least 3:1. `--band-text` is the blue for text, because `--band` is too dark for text in dark mode.
- **Names and labels (1.1.1, 1.3.1, 3.3.2, 4.1.2):** every field has a label; every button has a name, including icon-only ones; count steppers say which item they change ("Plus one, Coffee Lids"); decorative icons are hidden from screen readers.
- **Structure (1.3.1, 2.4.2, 2.4.6):** each screen has one page heading and its own page title, with no skipped heading levels. When the screen changes, focus moves to its heading so screen readers say where you are.
- **Sheets (2.4.3):** dialogs are modal; the page behind them is inert while one is open, and focus returns afterwards.
- **No time limits (2.2.1):** tap-twice deletes stay armed until you tap again or tap anything else, and the prompt is announced.
- **Errors (3.3.1):** a number the app can't read is marked invalid for screen readers, shown by more than color, and explained in words.
- **Targets and focus (2.5.8, 2.4.7, 2.4.11):** everything tappable is at least 24×24 px (most are 40 px or more); focus is always outlined and scrolls clear of the fixed header and tab bar.
- **Also:** smallest text is 12 px; motion is off when the phone asks for reduced motion; pinch zoom is never blocked.

Still to do: a pass with TalkBack (Android) and VoiceOver (iPhone); the printed cards are separate work.

## Sync

- Works offline after the first load (service worker). Data lives in IndexedDB on the phone.
- GitHub's API is the only outside address the app contacts. Everything else, fonts included, ships with the app; the page's security rules allow nothing else, and `tests/offline.test.mjs` checks it.
- Syncs when you tap Sync, and quietly on its own when the app opens, comes back to the front or regains signal, after a count is saved or an order is placed, and about 20 seconds after an item edit or a flag.
- Merges three ways (last-synced copy, phone, GitHub), item by item. Saved counts and orders are new records, so two people's never collide. Bookkeeping fields (`updated`, `by`) never count as a clash.
- A deleted saved count stays deleted. The shared file keeps a marker (the count's id and when it was deleted, nothing else), so an old phone or an old backup that still has the count can't bring it back. If one phone deletes a count while another changes it (marks it placed, say), the count is kept and a note says so, so an order isn't lost.
- Saving a count or editing an item while a sync is sending is safe: the change stays on the phone and goes up in a quiet sync right after.
- If two phones change the same inventory field between syncs, the phone's value stays and a "Keep mine / Use theirs" prompt appears on the Count tab. Once that value changes again (someone settles on something newer), the prompt goes away, so an old prompt can't undo a newer change. For the book, the phone wins and a merge note is kept under More → Sync.
- Everything from the shared files is shown as text, never as page markup, since anyone with access can edit them (even by hand on github.com).
- Orders are records of their own, filed by Order placed: placed → received, with initials and dates. Two phones that each file an order before syncing keep both; if the two share lines and were filed within a day, the phone that syncs second is told, in case one order went out twice. Saved counts from before 1.8.0 can still carry an order that was never placed; it shows and can be marked, and reads "replaced" once there's a newer order.
- What to order is a shared list of flags on the lines (see Counting and ordering). A cleared flag stays cleared: each line keeps the time its flag was last cleared, and a flag only counts if it was set after that, so an old phone or backup can't bring one back. A flag and its amount travel together. Two phones flagging one line with different amounts get "Keep mine / Use theirs"; a phone whose flag went on the other phone's order, or was taken off there, gets a note. All of this is `mergeFlags` in `js/stock.js`.
- A phone on 1.7.1 or older can share files with a newer one without losing anything, but its saved counts have no room, so each becomes the first room's newest count. Update every phone before anyone counts by room.

## Floor plans

Book → Maps. Each room has walls, tables, bar seats, counters and labels (entrance, kitchen, window), drawn on a grid of squares. The whole floor is kept as versions:

- **In use:** the layout everyone works from. Changing it directly is allowed (for fixing a mistake), with a warning that older printouts are now out of date.
- **Drafts:** a copy of the whole floor for drawing the next layout ahead of a remodel. Nothing changes for anyone until someone taps "Use this one now". Then the old layout is kept as "not in use", with the dates it was in use.
- Rooms and tables keep their ids in every version, so a table is the same table before and after it moves. A room can be marked closed for work, with a note.

Tables move by dragging, or with the arrow buttons (no dragging needed, WCAG 2.5.7); every table and every corner of the walls can also be picked from a list of buttons. Printouts put each room on its own page with the version's name and the date it went into use, and a version going out of use makes its printed copies show as out of date under Lead → Printed. Deleting a version leaves a deletion marker (its id only); rooms and tables never get one, because they live on in other versions.

## Allergen card

Book → Allergens. One file, `card3.json`, holds a set of menu rows: dishes, sides, and the sauces, toppings and parts that go with them. Each row says which meals it's on, what goes out with it, its vegetarian, gluten-free and dairy-free marks, and its allergens. Each allergen on a row has a status:

- **In it, can't be left out.** Solid chip; listed on the back page.
- **In it as served, can be made without.** Solid chip; the back page says what to leave off.
- **Ask** (not confirmed) and **Ask, check the label** (packaged). Dashed chip with a question mark: treat as in it.

Shared equipment (a fryer, a flat-top) is its own list: what it carries, and which rows use it. Those rows get its chip, and the back page lists it under each allergen it carries.

The four Letter pages are worked out from the rows every time they're shown: the guide, the back page ("can't leave it out", by allergen across all menus), and a menu page each for breakfast and for lunch and dinner. Nothing is typed onto a page, so a menu change is one edit and no page can disagree with another. The app holds the layout only; every word about a menu comes from the file.

**Kitchen checked** is a name and a date tied to a fingerprint of everything the kitchen looked at. Change any row, any shared equipment or any word, on any phone or by hand in the file, and the fingerprint no longer matches: every page prints "Draft · kitchen to check" until someone checks it again. Undoing the change doesn't bring the check back. It's a guard against drift, not a signature: someone who edits the file by hand on purpose could forge it.

If two phones change the same row's allergens between syncs, every entry from both is kept (the ordinary merge would keep one phone's list), the card screen names the rows to check, and the card can't be marked checked until someone has.

The card screen measures the pages with the app's own fonts and warns when one has grown past the bottom of the sheet, before printing too. Print with Letter paper, margins None, scale 100%. A view-only key can look and print.

## Counting and ordering

Count has four screens: Count, Order, History and Items. The data and math behind them (rooms, what's on hand, flags, orders, unit conversion) live in `js/stock.js`; the screens live in `js/views/count.js`.

- **Two rooms.** Stock is counted in two rooms, each on its own: Servery (backup stock) and Kitchen (open, working stock), fixed in `PLACES`. Each room saves as its own count, on its own day, by anyone. A phone keeps one count in progress per room; switching rooms leaves the other waiting. A count saved before 1.8.0 has no room and reads as the first one.
- **Totals** adds the newest saved count of each room, line by line, in the line's unit today, and shows each room's date and who counted. The newest count of a room replaces the older one whole: a line it leaves out reads "not counted" there and adds nothing. History tags the count each room's total comes from "In Totals".
- **Cases and loose.** A line whose product has a per-case number is counted as full cases plus loose units, added up into the line's unit. A count is stored as one number in the line's unit. Changing the unit or the per-case number converts it or clears it (`reconcileUnits`), never leaves it standing in a unit it wasn't counted in. Saved counts remember the unit, and the per-case number when counted as cases plus loose.
- **What to order is flagged by hand**, with the Order button on any Count line or the tick on Items. Nothing is worked out from minimums anymore; they stay in the file and show only under More in an item's panel. The flag and its amount are saved on the line, so everyone who orders sees one list. The amount is a whole number, in cases when the product to order has a case size, otherwise in the line's unit. Only lines on the order sheet can be flagged, and moving a line off the sheet or back on clears its flag.
- **Order** lists the flagged lines with what's on hand in both rooms, the product to order, who flagged it, the amount and Remove. Then the message for team chat (Copy, Share), and Order placed, which takes two taps, files an order record next to the saved counts and clears the flags it used. If the list changes after the message was copied (the other phone flags a line), the screen says what changed, and Order placed says so on its first tap. Orders anyone placed in the last two weeks that haven't arrived show at the top.
- **How often.** Each line is in one of four groups: Every few days, Weekly, Monthly, Not regular. Count, Items and the printed sheet group by it, then by section A to Z.
- **Items** is a ledger: Order tick, name, Size and How often, sorted by how often, A to Z, or to order. Tapping How often steps to the next group. Tapping Size opens "How it's counted" rather than stepping the unit, since some steps can't be converted and would clear a count. Tapping a name opens a panel with what's on hand, the case size, the order amount, and every other field under More.

## Printing

Prints a revision stamp on every page and keeps a log of where printed copies went, so stale copies are easy to spot.

The blank count sheet has a column to write in for each room and one for what to order, in the Count screen's order, with what each line is counted in under its name.

Phone browsers print after `window.print()` returns and report "afterprint" at once, so a printout stays in place (print only, never on screen) until the first tap or key back in the app. Whatever comes first in a printout never starts a new page, and printing waits for the history step that closing the Print sheet makes. `tests/print-phone.py` checks this in Chrome. Firefox and Safari aren't covered by any test here.

## Building

Internal names stay as they were (the IndexedDB name `multitool`, backup type `multitool-backup`, private-file type `multitool-private`) so older backup files still import.

No build step: plain HTML, CSS and ES modules. To release a change, bump `VERSION` in `sw.js` (and `app.version` in `js/main.js`) so installed copies pick it up. Every merge that changes an app file needs a version of its own: a phone only fetches the app again when `sw.js` changes, so a second fix merged under a number that was already out never reaches phones that took the first. `tests/version.test.mjs` checks against main. Notes and tests don't count as app files.

Fonts (in `fonts/`): Atkinson Hyperlegible, IBM Plex Mono and Sofia Sans Extra Condensed, all under the SIL Open Font License (license files alongside). They were made from the google/fonts repository's files, cut down to Latin and Latin-extended letters, and saved as WOFF2.
