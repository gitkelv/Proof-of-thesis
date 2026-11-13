// Builds the static site into _site/ (site + model), ready for any static host.
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
const root = new URL("..", import.meta.url);
const out = new URL("_site/", root);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(new URL("site/", root), out, { recursive: true });
cpSync(new URL("model/", root), new URL("model/", out), { recursive: true });
if (!existsSync(new URL("data/latest.json", out))) console.warn("warning: no site/data/latest.json; the page will grade live in the browser");
console.log("Built _site/");
