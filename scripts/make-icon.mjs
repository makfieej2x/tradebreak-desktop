// Renders build/icon.svg (the TradeBreak logo) to the 1024px PNG electron-builder needs.
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const svg = readFileSync(new URL("../build/icon.svg", import.meta.url));
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync(new URL("../build/icon.png", import.meta.url), png);
console.log(`build/icon.png written (${png.length} bytes)`);
