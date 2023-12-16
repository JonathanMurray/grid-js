"use strict";

import { Readline } from "/lib/readline.mjs";
import { writeError, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { ANSI_CSI } from "/shared.mjs";


async function main(args) {
    let fd;
    if (args.length >= 1) {
        const fileName = args[0];
        try {
            fd = await syscall("openFile", {fileName});
        } catch (error) {
            await writeError(error["message"]);
            return;
        }
    } else {
       fd = 0; // stdin
    }

    await writeln(`${ANSI_CSI}37;45m~JavaScript REPL~${ANSI_CSI}39;49m`);

    const readline = new Readline();

    // We rely on a piece of JavaScript witchery for the REPL:
    // https://stackoverflow.com/a/67394423 "during each eval() call, we create
    // a new closure inside that eval scope and export it so that to we can use
    // it evaluate the next statement."
    //
    // This allows us to input code that references previously submitted code.
    // Example:
    // >>> const x = 5;
    // >>> x
    // [5]
    //
    // Note: The 'void' keyword is needed to prevent the __EVAL assignment from
    // affecting the return value from eval(). Only the evaluation of the
    // code argument is allowed to affect the return value.
    let __EVAL = code => eval(`void (__EVAL = ${__EVAL.toString()}); ${code}`);

    let uncommitted = "";
    while (true) {
        const prompt = uncommitted.length == 0 ? ">>> " : "... ";
        const line = await readline.readLine(prompt);
        if (line == null) {
            break;
        }

        uncommitted += line;

        try {
            const output = __EVAL(uncommitted);
            uncommitted = "";
            if (output != undefined) {
                await writeln(`${ANSI_CSI}37;45m${output}${ANSI_CSI}39;49m`);
            }
        } catch (e) {
            // If we have incomplete input, allow the user to continue on the next line.
            if (!(e instanceof SyntaxError && e.message == "Unexpected end of input")) {
                uncommitted = "";
                writeError(e);
            }
        }
    }
}

