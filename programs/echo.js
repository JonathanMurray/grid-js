"use strict";

import { writeln } from "/lib/stdlib.mjs";

async function main(args) {
    for (let word of args) {
        await writeln(word);
    }
}
