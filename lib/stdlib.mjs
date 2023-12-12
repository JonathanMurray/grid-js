import { ANSI_CSI, ANSI_DISABLE_ALTERNATIVE_BUFFER, ANSI_ENABLE_ALTERNATIVE_BUFFER, ANSI_ERASE_ENTIRE_SCREEN, ANSI_GET_CURSOR_POSITION, ASCII_END_OF_TRANSMISSION, ansiCustomTerminalCommand, assert } from "/shared.mjs";

import { pid, syscall } from "./sys.mjs";

async function createWindow(title, size, options, args) {

    let resizable = true;
    let menubarItems;
    let preventExitOnClose = false;
    if (options != undefined) {
        if ("resizable" in options) {
            resizable = options.resizable;
        }
        if ("menubarItems" in options) {
            menubarItems = options.menubarItems;
        }
        if ("preventExitOnClose" in options) {
            preventExitOnClose = options.preventExitOnClose;
        }
    }

    class WindowProxy {
        constructor() {
            this._handlers = {
                keydown: [],
                click: [],
                mousedown: [],
                mouseup: [],
                mousemove: [],
                mouseout: [],
                windowWasResized: [],
                wheel: [],
                menubarButtonWasClicked: [],
                menubarDropdownItemWasClicked: [],
                closeWasClicked: [
                    (_event) => {
                        if (!preventExitOnClose) {
                            syscall("exit");
                        }
                    }
                ]
            };
            this.canvas = null;
        }

        addEventListener(name, handler) {
            assert (name in this._handlers);
            this._handlers[name].push(handler);
        }
    }

    let win = new WindowProxy();

    handleWindowInput((name, event) => { 
        assert(name in win._handlers);
        for (const handler of win._handlers[name]) {
            handler(event);
        }
        if (name == "windowWasResized") {
            postMessage({resizeDone: null});
        }
    });

    win.canvas = await syscall("graphics", {title, size, resizable, menubarItems});

    return win;
}

function write(text, fd) {
    if (fd == undefined) {
        // stdout by default
        fd = 1;
    }
    return syscall("write", {text, fd});
}

function writeln(line, fd) {
    return write(line + "\n", fd);
}

function writeError(message, fd) {
    return write(`${ANSI_CSI}37;41mError${ANSI_CSI}39;49m <${message}>\n`, fd)
}

function read(fd) {
    if (fd == undefined) {
        // stdin by default
        fd = 0;
    }
    return syscall("read", {fd});
}

function log(args) {
    console.log(`[${pid()}]`, args);
}

const terminal = function() {
    async function clear() {
        await write(ANSI_ERASE_ENTIRE_SCREEN);
    }

    async function enterAlternateScreen() {
        await write(ANSI_ENABLE_ALTERNATIVE_BUFFER);
    }

    async function exitAlternateScreen() {
        await write(ANSI_DISABLE_ALTERNATIVE_BUFFER);
    }

    async function setTextStyle(style) {
        await writeCommand({setTextStyle: style});
    }

    async function setBackgroundStyle(style) {
        await writeCommand({setBackgroundStyle: style});
    }

    async function getCursorPosition() {
        await write(ANSI_GET_CURSOR_POSITION);
        let skippedInput = "";
        while (true) {
            const response = await read();

            const responseRegex = /\x1B\[(.+);(.+)R/;
            const responseMatch = response.match(responseRegex);
            if (!responseMatch) {
                skippedInput += response;
                continue;
            }
            if (responseMatch.index > 0) {
                skippedInput += response.slice(0, responseMatch.index);
            }
            const line = Number.parseInt(responseMatch[1]);
            const col = Number.parseInt(responseMatch[2]);
            assert(Number.isInteger(line) && Number.isInteger(col), "Invalid cursor position response: " + response);
            return {skippedInput, position: [line, col]};
        }
    }

    async function writeCommand(command) {
        command = JSON.stringify(command);
        const len = command.length;
        console.assert(len < 256);
        await write(`${ansiCustomTerminalCommand(len)}${command}`);
    }

    return {clear, setTextStyle, setBackgroundStyle, writeCommand, enterAlternateScreen, exitAlternateScreen, getCursorPosition};
} ();


class BufferedReader {
    constructor() {
        this.buf = "";
        this.hasReachedEnd = false;
    }

    async readLine() {
        if (this.hasReachedEnd) {
            return null;
        }

        while (!this.buf.includes("\n") && !this.buf.includes(ASCII_END_OF_TRANSMISSION)) {
            const read = await syscall("read", {fd: 0});
            if (read == "") {
                this.hasReachedEnd = true;
                return null;
            }
            this.buf += read;
        }

        const newlineIndex = this.buf.indexOf("\n");
        const eotIndex = this.buf.indexOf(ASCII_END_OF_TRANSMISSION);

        if (eotIndex >= 0 && (eotIndex < newlineIndex || newlineIndex == -1)) {
            // the end of the stream has been reached
            this.hasReachedEnd = true;
            return null;
        }

        console.assert(newlineIndex >= 0, `eotindex: ${eotIndex}, newlineIndex: ${newlineIndex}`);

        const line = this.buf.slice(0, newlineIndex);
        this.buf = this.buf.slice(newlineIndex + 1);
        return line;
    }
}

const bufferedReader = new BufferedReader();
const readln = () => bufferedReader.readLine();

export {createWindow, terminal, write, writeln, writeError, read, readln, log};


