# Lockin

A local-first study timer with a split-flap clock and a focus bank. Pick a time, work until the bell, and bank the time you actually put in.

## Run it

Requires Node.js 24 or newer.

```sh
npm ci
npm start
```

That builds the app and opens it at `http://127.0.0.1:2525`. To install the command globally, use `npm run install:global` and then run `study` from any directory. Use `study status` or `study stop` to manage the local server.

## Find a rhythm

- **Space** starts, pauses or resumes. **← / →** picks a phase.
- **↑ / ↓** adjusts minutes. Hold **Shift** for five minutes, or type a duration directly.
- **B** banks an unfinished focus session after at least one minute. **R** resets without banking.
- **V** toggles Study View, which hides the bank and music strip without interrupting the timer. **Esc** returns to the dashboard. **M** toggles sound.
- The bank shows daily activity over the last 28 local calendar days. Hover, tap, or navigate its tiles with the keyboard for exact session totals. Milestones appear on the split-flap board.

Timer state and the bank live in this browser. A different port, browser or browser profile has its own storage. Use the bank’s JSON export to back up or move your history.

## Develop

```sh
npm run dev
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

The end-to-end suite builds the production app and runs it on its own local port.
