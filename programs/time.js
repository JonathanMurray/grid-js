"use strict";

import { writeln } from "/lib/stdlib.mjs";

async function main(args) {
    const now = new Date();
    await writeln(`${now.toLocaleTimeString("sv-SE")}`);
}


