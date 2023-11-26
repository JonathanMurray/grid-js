const ASCII_ESCAPE = "\x1B";

/** Ctrl-C */
const ASCII_END_OF_TEXT = "\x03";
/** Ctrl-D */
const ASCII_END_OF_TRANSMISSION = "\x04";
const ASCII_BACKSPACE = "\x08";
const ASCII_CARRIAGE_RETURN = "\x0D"

// https://notes.burke.libbey.me/ansi-escape-codes/
// https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
// https://vt100.net/docs/vt100-ug/chapter3.html#ED

/** Control Sequence Introducer */
const ANSI_CSI = `${ASCII_ESCAPE}[`

const ANSI_CURSOR_UP = `${ANSI_CSI}A`;
const ANSI_CURSOR_DOWN = `${ANSI_CSI}B`;
const ANSI_CURSOR_FORWARD = `${ANSI_CSI}C`;
const ANSI_CURSOR_BACK = `${ANSI_CSI}D`;
const ANSI_CURSOR_END_OF_LINE = ansiSetCursorHorizontalAbsolute(999); // We assume fewer than 999 columns
/** EL – Erase In Line (all) */
const ANSI_ERASE_ENTIRE_LINE = `${ANSI_CSI}2K`
/** EL – Erase In Line (to right)*/
const ANSI_ERASE_LINE_TO_RIGHT = `${ANSI_CSI}0K`
/** ED – Erase In Display */
const ANSI_ERASE_ENTIRE_SCREEN = `${ANSI_CSI}2J`

/** Cursor Position Report (request)*/
const ANSI_GET_CURSOR_POSITION = `${ANSI_CSI}6n`;

// https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#common-private-modes
const ANSI_ENABLE_ALTERNATIVE_BUFFER = `${ANSI_CSI}?1049h`;
const ANSI_DISABLE_ALTERNATIVE_BUFFER = `${ANSI_CSI}?1049l`;

function ansiBackgroundColor(text, color) {
    return `${ANSI_CSI}${color}m${text}${ANSI_CSI}49m`
}

/** Cursor Position Report (response)*/
function cursorPositionReport(line, col) {
    return `${ANSI_CSI}${line};${col}R`;
}

/** Cursor Horizontal Absolute */
function ansiSetCursorHorizontalAbsolute(col) {
    return `${ANSI_CSI}${col}G`;
}

/** CUP – Cursor Position */
function ansiCursorPosition(line, col) {
    return `${ANSI_CSI}${line};${col}H`;
}

/** "Custom" CSI, used for non-standard terminal commands */
function ansiCustomTerminalCommand(commandLen) {
    return `${ANSI_CSI}${commandLen}X`;
}

const Errno = {
    WOULDBLOCK: "WOULDBLOCK",
}


class TextWithCursor {
    constructor() {
        this.text = "";
        this.cursor = 0;
    }

    moveRight() {
        if (this.cursor < this.text.length) {
            this.cursor ++;
            return true;
        }
        return false;
    }

    moveLeft() {
        if (this.cursor > 0) {
            this.cursor --;
            return true;
        }
        return false;
    }
    
    moveToStart() {
        this.cursor = 0;
    }

    moveToEnd() {
        // The cursor is intentionally _after_ the last character.
        this.cursor = this.text.length;
    }

    insert(text) {
        this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
        this.cursor += text.length;
    }

    reset() {
        this.text = "";
        this.cursor = 0;
    }

    enter() {
        this.text += "\n";
    }

    backspace() {
        if (this.cursor > 0) {
            this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
            this.cursor --;
            return true;
        }
        return false;
    }
}

function assert(condition, message) {
    if (!condition) {
        console.error("Assertion failed:", message);
        debugger;
    }
}