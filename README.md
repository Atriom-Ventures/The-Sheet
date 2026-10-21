# MultiTool

An offline, installable shift tool for one person's phone: checklists, how-to cards, an assignment sheet, an inventory count, shift notes, a floor board with breaks, follow-ups, and plain-text messages for team chat.

**This repository holds no data.** It's an empty app. Content comes from a separate private repository that the app reads and writes through the GitHub API with a fine-grained token stored only on the phone. Phone-only things (shift notes, the floor board, trainee names, message drafts) never leave the device.

- Works offline after the first load (service worker).
- Data lives in the browser's IndexedDB on the phone.
- Sync is manual and merges three ways (last-synced copy, phone, GitHub); if both sides changed the same item, the phone's version is kept and the other is noted.
- Prints a revision stamp on every page and keeps a log of where printed copies went, so stale copies are easy to spot.

No build step: plain HTML, CSS and ES modules. To release a change, bump `VERSION` in `sw.js` (and `app.version` in `js/main.js`) so installed copies pick it up.
