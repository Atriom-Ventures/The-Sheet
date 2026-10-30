# The Sheet

(Formerly MultiTool.) An offline, installable shift tool: checklists, how-to cards, an assignment sheet, an inventory count with ordering, shift notes, a floor board with breaks, follow-ups, and plain-text messages for team chat.

**This repository holds no data.** It's an empty app. Content comes from private repositories that the app reads and writes through the GitHub API, with fine-grained tokens stored only on the phone. Phone-only things (shift notes, the floor board, trainee names, message drafts, the count in progress) never leave the device.

## Two connections

- **Book** (one person): `book.json` and `state.json`: checklists, cards, the day, follow-ups, wins, the printed-copies log.
- **Inventory** (shared by everyone who counts and orders): `inventory.json` (lines and products) and `counts.json` (saved counts and order status). If no inventory connection is set, these two files sync to the book repo instead.

A phone with only an inventory connection runs in **count-only mode**: just the Count and More tabs.

Setup links: `#setup=owner/repo` prefills the book connection, `#setup=inv:owner/repo` the inventory one. On an iPhone, add the app to the Home Screen first and set up inside the installed app: its storage is separate from Safari's, and Safari may clear a tab's data after a week without a visit.

## Sync

- Works offline after the first load (service worker). Data lives in IndexedDB on the phone.
- Syncs when you tap Sync, and quietly on its own when the app opens, comes back to the front or regains signal, after a count is saved, and about 20 seconds after an item edit.
- Merges three ways (last-synced copy, phone, GitHub), item by item. Saved counts are new records, so two people's counts never collide. Bookkeeping fields (`updated`, `by`) never count as a clash.
- If two phones change the same inventory field between syncs, the phone's value stays and a "Keep mine / Use theirs" prompt appears on the Count tab. For the book, the phone wins and a merge note is kept under More → Sync.
- Saved counts with something to order carry a status: not placed → placed → received, with initials and dates, so two people never place the same order. An unplaced order is replaced when anyone saves a newer count with its own order.

Prints a revision stamp on every page and keeps a log of where printed copies went, so stale copies are easy to spot.

Internal names stay as they were (the IndexedDB name `multitool`, backup type `multitool-backup`, private-file type `multitool-private`) so older backup files still import.

No build step: plain HTML, CSS and ES modules. To release a change, bump `VERSION` in `sw.js` (and `app.version` in `js/main.js`) so installed copies pick it up.
