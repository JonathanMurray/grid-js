// https://notes.burke.libbey.me/ansi-escape-codes/

const ANSI_ESCAPE = "\x1B";
// Control Sequence Introducer
const ANSI_CSI = `${ANSI_ESCAPE}[`

const ANSI_CURSOR_UP = `${ANSI_CSI}A`;
const ANSI_CURSOR_DOWN = `${ANSI_CSI}B`;
const ANSI_CURSOR_FORWARD = `${ANSI_CSI}C`;
const ANSI_CURSOR_BACK = `${ANSI_CSI}D`;
const ANSI_CURSOR_END_OF_LINE = ansiSetCursorPosition(999); // We assume fewer than 999 columns

function ansiSetCursorPosition(pos) {
    return `${ANSI_CSI}${pos}G`;
}

// "Custom" CSI, used for non-standard terminal commands
function ansiCustomTerminalCommand(commandLen) {
    return `${ANSI_CSI}${commandLen}X`;
}

const ASCII_END_OF_TEXT = "\x03"; // Ctrl-C
const ASCII_END_OF_TRANSMISSION = "\x04"; // Ctrl-D
const ASCII_BACKSPACE = "\x08";
const ASCII_CARRIAGE_RETURN = "\x0D"

class TextWithCursor {
    constructor() {
        this.text = "";
        this.cursor = 0;
    }

    moveRight() {
        this.cursor = Math.min(this.cursor + 1, this.text.length);
    }

    moveLeft() {
        this.cursor = Math.max(this.cursor - 1, 0);
    }
    
    moveToStart() {
        this.cursor = 0;
    }

    moveToEnd() {
        this.cursor = this.text.length - 1;
    }

    insert(text) {
        this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
        this.cursor += text.length;
    }

    reset() {
        this.text = "";
        this.cursor = 0;
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
        console.error("Assertion failed", message);
        debugger;
    }
}