"use strict";

import { ANSI_CSI } from "/shared.mjs";

async function main(args) {
    console.log(JSON.stringify(self));
    console.log(Object.keys(self));
    console.log(self);
    console.log(ANSI_CSI);
}
