import "./ui/styles.css";
import { startApp } from "./app.ts";
import { loadDigitFace } from "./ui/flip.ts";

// The clock is built only once the digit face is measured, so it never paints
// in a fallback font or with a misplaced split.
await loadDigitFace();
startApp(document.body);
