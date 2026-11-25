// Bundles React and the app into ONE self-contained HTML file: no CDN, no remote fonts.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const res = await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  write: false,
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const tpl = readFileSync("src/template.html", "utf8");
const html = tpl.replace("/*__APP__*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/woi-research-desk.html", html);
console.log(`dist/woi-research-desk.html  ${(html.length / 1024).toFixed(0)} KB (js ${(js.length / 1024).toFixed(0)} KB)`);
