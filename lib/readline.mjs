import { read, terminal, write } from "./stdlib.mjs";
import { syscall } from "./sys.mjs";
import { ANSI_CURSOR_BACK, ANSI_CURSOR_DOWN, ANSI_CURSOR_END_OF_LINE, ANSI_CURSOR_FORWARD, ANSI_CURSOR_UP, ANSI_ERASE_LINE_TO_RIGHT, ASCII_BACKSPACE, ASCII_CARRIAGE_RETURN, ASCII_END_OF_TEXT, ASCII_END_OF_TRANSMISSION, TextWithCursor, ansiSetCursorHorizontalAbsolute } from "../shared.mjs";

const STDIN = 0;

export class Readline {
    constructor() {
        this.history = new History();
        this._editLine = new TextWithCursor();
    }

    async readLine(prompt, promptLen) {

        await syscall("controlDevice", {fd: STDIN, request: {mode: "CHARACTER"}});
        
        let editLine = this._editLine;
        
        const {skippedInput, position: [_line, startCol]} = await terminal.getCursorPosition();

        function line() {
            return `${ansiSetCursorHorizontalAbsolute(startCol)}${ANSI_ERASE_LINE_TO_RIGHT}${prompt}${editLine.text}`;
        }

        let received = skippedInput;

        while (true) {

            await write(line() + ansiSetCursorHorizontalAbsolute(startCol + promptLen + editLine.cursor));

            // If we read some input before getting the cursor position response, we use that instead of reading again
            if (received == "") {
                received = await read();
            }

            while (received != "") {
                let matched;
                let enter = false;
                let ctrlD = false;
                let ctrlC = false;
                let up = false;
                let down = false;
                if (received[0] == ASCII_BACKSPACE) {
                    editLine.backspace();
                    matched = 1;
                } else if (received[0] == "\n") {
                    enter = true;
                    matched = 1;
                } else if (received[0] == ASCII_END_OF_TRANSMISSION) {
                    ctrlD = true;
                    matched = 1;
                } else if (received[0] == ASCII_END_OF_TEXT) {
                    ctrlC = true;
                    matched = 1;
                } else if (received[0] == ASCII_CARRIAGE_RETURN) {
                    editLine.moveToStart();
                    matched = 1;
                } else if (received.startsWith(ANSI_CURSOR_BACK)) {
                    editLine.moveLeft();
                    matched = ANSI_CURSOR_BACK.length;
                } else if (received.startsWith(ANSI_CURSOR_FORWARD)) {
                    editLine.moveRight();
                    matched = ANSI_CURSOR_FORWARD.length;
                } else if (received.startsWith(ANSI_CURSOR_END_OF_LINE)) {
                    editLine.moveToEnd();
                    matched = ANSI_CURSOR_END_OF_LINE.length;
                } else if (received.startsWith(ANSI_CURSOR_UP)) {
                    up = true;
                    matched = ANSI_CURSOR_UP.length;
                } else if (received.startsWith(ANSI_CURSOR_DOWN)) {
                    down = true;
                    matched = ANSI_CURSOR_DOWN.length;
                } else {
                    editLine.insert(received[0]);
                    matched = 1;
                } 
    
                received = received.slice(matched);
    
                let committedLine;

                if (enter) {
                    await write(line() + "\n");
                    this.history.onEnter(editLine.text);
                    committedLine = editLine.text;
                    editLine.reset();
                } else if (ctrlC) {
                    await write(line() + "^C\n");
                    this.history.clearSelection();
                    editLine.reset();
                    committedLine = ""; // Input is discarded
                } else if (ctrlD) {
                    await write(line() + "^D\n");
                    const emptyLine = editLine.text.length == 0;
                    editLine.reset();
                    if (emptyLine) {
                        committedLine = null; // This represents EOF
                    } else {
                        committedLine = ""; // Input is discarded
                    }
                } else if (up) {
                    const selectedLine = this.history.onCursorUp();
                    if (selectedLine != null) {
                        editLine.text = selectedLine;
                        editLine.moveToEnd();
                    } else {
                        editLine.reset();
                    }
                } else if (down) {
                    const selectedLine = this.history.onCursorDown();
                    if (selectedLine != null) {
                        editLine.text = selectedLine;
                        editLine.moveToEnd();
                    } else {
                        editLine.reset();
                    }
                }

                if (committedLine !== undefined) {
                    await syscall("controlDevice", {fd: STDIN, request: {mode: "LINE"}});
                    return committedLine;
                }

            }
        }
    }
}


class History {
    constructor() {
        this.lines = [];
        this.selected = null;
    }

    onEnter(line) {
        if (line != "") {
            this.lines.push(line);
        }
        this.selected = null;
    }
    
    clearSelection() {
        this.selected = null;
    }

    onCursorUp() {
        if (this.selected != null) {
            this.selected -= 1;
        } else {
            this.selected = this.lines.length - 1;
        }
        if (this.selected >= 0) {
            const line = this.lines[this.selected];
            return line;
        } else {
            this.selected = null;
            return null;
        }
    }

    onCursorDown() {
        if (this.selected != null) {
            this.selected += 1;
        } else {
            this.selected = 0;
        }
        if (this.selected < this.lines.length) {
            const line = this.lines[this.selected];
            return line;
        } else {
            this.selected = null;
            return null;
        }
    }
}