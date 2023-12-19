"use strict";

import { Errno } from "/kernel/errors.mjs";
import { DocumentWithCursor } from "/lib/document-cursor.mjs";
import { writeError, read, write, terminal } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { FileType, ANSI_ERASE_ENTIRE_SCREEN, ANSI_CSI, ANSI_CURSOR_UP, ANSI_CURSOR_DOWN } from "/shared.mjs";

async function main(args) {

    try {
        if (args.length >= 1) {
            const path = args[0];
            let fd;
            try {
                fd = await syscall("openFile", {path});
            } catch (e) {
                writeError(e["message"]);
                return;
            }
            await run(fd);
        } else {
            const stdin = 0;
            const status = await syscall("getFileStatus", {fd: stdin});
            if (status.type == FileType.PTY) {
                writeError("specify file or use non-pty stdin")
                return;
            }
            await run(stdin);
        }
    } catch (error) {
        if (error["name"] != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        await terminal.exitAlternateScreen();
    }
}

async function run(contentFd) {

    // https://unix.stackexchange.com/questions/452757/how-does-less-take-data-from-stdin-while-still-be-able-to-read-commands-from-u
    const ptyInputFd = await syscall("openPseudoTerminalSlave");

    await syscall("handleInterruptSignal");
    await syscall("configurePseudoTerminal", {mode: "CHARACTER_AND_SIGINT"});
    await terminal.enterAlternateScreen();

    let lines;
    let doc;
    let lineNumberWidth;
    let leftMargin;

    let lineWidth;
    let rows;
    let lineToRowMapping = null;
    let inputBuffer = "";

    let termsize = await syscall("getTerminalSize");

    async function loadContents() {
        try {
            await syscall("seekInFile", {fd: contentFd, position: 0});
        } catch (error) {
            // The input stream may not be seekable.
            if (error["errno"] != Errno.SPIPE) {
                throw error;
            }
        }
        const text = await read(contentFd);
        lines = text.split(/\n|\r\n/);
        doc = new DocumentWithCursor(lines);
        lineNumberWidth = doc.lines.length.toString().length;
        leftMargin = lineNumberWidth + 1;

        await initGrid();
    }

    async function initGrid() {
        lineWidth = termsize[0] - leftMargin;
        let lineBeginnings;
        ({rows, lineBeginnings} = doc.calculateWrapped(lineWidth));

        let lineNumber = 1;
        lineToRowMapping = {};
        for (let rowIndx of lineBeginnings) {
            lineToRowMapping[lineNumber] = rowIndx;
            lineNumber ++;
        }

        await render();
    }

    async function onresize() {
        termsize = await syscall("getTerminalSize");
        await initGrid();
    }

    async function render() {
        let output = ANSI_ERASE_ENTIRE_SCREEN;
        let lineNumber = 1;
        for (let i = 0; i < rows.length; i++) {

            const lineBeginning = lineToRowMapping[lineNumber] == i;

            if (i >= offset) {
                if (lineBeginning) {
                    output +=  `${ANSI_CSI}36;44m${lineNumber.toString().padStart(lineNumberWidth)}${ANSI_CSI}39;49m `;
                } else {
                    output += `${ANSI_CSI}44m${"".padStart(lineNumberWidth)}${ANSI_CSI}49m `;
                }
                output += rows[i].padEnd(lineWidth)
            }

            if (i - offset == termsize[1] - 2) {
                break;
            }

            if (lineBeginning) {
                lineNumber ++;
            }
        }

        // Make sure input buffer is shown at the very bottom, even for short files.
        for (let i = 0; i < termsize[1] - rows.length; i++) {
            output += "\n";
        }

        output += `:${inputBuffer}`;
        await write(output);
    }

    function setOffset(value) {
        offset = Math.max(0, Math.min(value, rows.length - termsize[1]));
    }

    handleTerminalResizeSignal(onresize);

    let offset = 0;

    await loadContents();

    while (true) {
        await render();
        const input = await read(ptyInputFd);
                
        let isNumber = /^\d+$/.test(input);
        if (isNumber) {
            inputBuffer += input;
        } else {

            const lineNumber = Number.parseInt(inputBuffer);
            
            if ([ANSI_CURSOR_UP, "k"].includes(input)) {
                const delta = lineNumber >= 1 ? lineNumber : 1;
                setOffset(offset - delta);
            } else if ([ANSI_CURSOR_DOWN, "j"].includes(input)) {
                const delta = lineNumber >= 1 ? lineNumber : 1;
                setOffset(offset + delta);
            } else if (input == "d") {
                setOffset(offset + Math.ceil(termsize[1] / 2));
            } else if (input == "u") {
                setOffset(offset - Math.ceil(termsize[1] / 2));
            } else if (input == "g") {
                if (lineNumber >= 1) {
                    setOffset(lineToRowMapping[lineNumber]);
                } else {
                    setOffset(0);
                }
            } else if (input == "G") {
                if (lineNumber >= 1) {
                    setOffset(lineToRowMapping[lineNumber]);
                } else {
                    setOffset(rows.length - 1);
                }
            } else if (input == "R") {
                await loadContents();
            } else if (input == "q") {
                // Exit program
                break;
            } else {
                console.log("TODO: handle input: ", input);
            }
            inputBuffer = "";
        }
   
    }
}
