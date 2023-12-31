"use strict";

import {Grid} from "./grid.mjs";
import {DocumentWithCursor} from "../lib/document-cursor.mjs";
import { ANSI_CSI, assert, ASCII_CARRIAGE_RETURN, ASCII_BACKSPACE } from "../shared.mjs";

const CURSOR_COLOR = "#099";

export class TerminalGrid {
    // https://unix.stackexchange.com/questions/145050/what-exactly-is-scrollback-and-scrollback-buffer
    // https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-The-Alternate-Screen-Buffer

    constructor(size, defaultBackground, defaultForeground, cellSize) {
        this._size = size;
        this.numColumns = Math.floor(size[0] / cellSize[0]);
        this.numRows =  Math.floor(size[1] / cellSize[1]);
        this.defaultBackground = defaultBackground;
        this._defaultForeground = defaultForeground;
        this.cellSize = cellSize;

        this._normalMode = true;

        this._initAlternateBuffer();
        
        this._normal = {
            doc: new DocumentWithCursor(),
            rows: [],
            cursor: [0, 0],
            rowOffset: 0,
            fg: null,
            bg: null,
        };

        this._parent = null;
    }

    setParent(parent) {
        this._parent = parent;
    }

    getSize(available) {

        if (available[0] != this._size[0] || available[1] != this._size[1]) {
            this._size = [...available];
            this.numColumns = Math.floor(this._size[0] / this.cellSize[0]);
            this.numRows =  Math.floor(this._size[1] / this.cellSize[1]);
            this._onResize();
        }

        return {required: this._size, wanted: this._size};
    }

    _onResize() {
        if (!this._normalMode) {
            this._alternate.rows = this._alternate.rows.slice(0, this.numRows);
            for (let y = 0; y < this.numRows; y ++) {
                if (this._alternate.rows[y] == null) {
                    this._alternate.rows[y] = new Array(this.numColumns);
                }
                this._alternate.rows[y] = this._alternate.rows[y].slice(0, this.numColumns);
            }
        }

        this._parent.notifyChildChange();
    }

    _initAlternateBuffer() {
        this._alternate = {
            rows: [],
            cursor: [0, 0],
            fg: null,
            bg: null,
        };
        for (let y = 0; y < this.numRows; y ++) {
            this._alternate.rows.push(new Array(this.numColumns));
        }
    }

    setDefaultBackground(color) {
        this.defaultBackground = color;
    }

    setDefaultForeground(color) {
        this._defaultForeground = color;
    }

    setCellSize(cellSize) {
        this.cellSize = cellSize;
        this._size = [this.numColumns * this.cellSize[0], this.numRows * this.cellSize[1]];
        this._onResize();
    }

    _enterAlternate() {
        this._normalMode = false;
        this._initAlternateBuffer();
    }

    _exitAlternate() {
        this._normalMode = true;
    }

    cursorPosition() {
        if (this._normalMode) {
            // NOTE: This is cursor in the "underlying document", i.e. if the terminal consists of one very line
            // that is wrapped onto multiple rows, the cursor will be [<very large number>, 0]
            return [this._normal.doc.cursorChar, this._normal.doc.cursorLine];
        } else {
            return this._alternate.cursor;
        }
    }

    _scroll(deltaY) {
        if (this._normalMode) {
            if (deltaY > 0) {
                this._normal.rowOffset += 1;
            } else {
                this._normal.rowOffset = Math.max(this._normal.rowOffset - 1, 0);
            }
        }
    }

    _recalculateNormal() {
        const {rows, cursorRow, cursorCol} = this._normal.doc.calculateWrapped(this.numColumns);
     
        if(rows.length > this._normal.rows.length) {
            this._normal.rowOffset += rows.length - this._normal.rows.length;
        }

        this._normal.rows = rows;
        this._normal.cursor = [cursorCol, cursorRow];
    }

    draw(ctx, available, mouse, keydown) {

        if (available[0] != this._size[0] || available[1] != this._size[1]) {
            console.log(`terminalGrid.draw() .. size=${this._size}, available=${available}`);
            this._size = [...available];
            this.numColumns = Math.floor(this._size[0] / this.cellSize[0]);
            this.numRows =  Math.floor(this._size[1] / this.cellSize[1]);
            console.log("onResize in draw");
            this._onResize();
        }

        if (mouse.scrollDelta) {
            this._scroll(mouse.scrollDelta);
        }

        ctx.fillStyle = this.defaultBackground;;
        ctx.fillRect(0, 0, available[0], available[1]);

        if (this._normalMode) {
            this._recalculateNormal();

            if (this._normal.rowOffset > this._normal.rows.length - this.numRows) {
                this._normal.rowOffset = Math.max(this._normal.rows.length - this.numRows, 0);
            }

            let rowOffset = this._normal.rowOffset;

            for (let y = rowOffset; y < this.numRows + rowOffset; y++) {
                for (let x = 0; x < this.numColumns; x ++) {

                    const isCursorCell = y == this._normal.cursor[1] && x == this._normal.cursor[0];
                    if (isCursorCell) {
                        ctx.fillStyle = CURSOR_COLOR;
                    } else {
                        ctx.fillStyle = this.defaultBackground;
                    }
                    Grid.fillCell(ctx, this.cellSize, [x, y - rowOffset]);

                    if (y < this._normal.rows.length && x < this._normal.rows[y].length) {
                        const row = this._normal.rows[y];
                        const {char, fg, bg} = row[x];

                        if (!isCursorCell) {
                            ctx.fillStyle = bg || this.defaultBackground;
                            Grid.fillCell(ctx, this.cellSize, [x, y - rowOffset]);
                        }

                        ctx.fillStyle = fg || this._defaultForeground;
                        Grid.characterCell(ctx, this.cellSize, [x, y - rowOffset], char, {});
                    }
                }
            }

            if (this.numRows < this._normal.rows.length) {
                this._drawScrollBar(ctx);
            }

        } else {

            for (let y = 0; y < this.numRows; y++) {
                for (let x = 0; x < this.numColumns; x ++) {
                    
                    const isCursorCell = y == this._alternate.cursor[1] && x == this._alternate.cursor[0];
                    if (isCursorCell) {
                        ctx.fillStyle = CURSOR_COLOR;
                    } else {
                        ctx.fillStyle = this.defaultBackground;
                    }
                    Grid.fillCell(ctx, this.cellSize, [x, y]);

                    const row = this._alternate.rows[y];
                    if (x in row) {
                        const {char, fg, bg} = row[x];

                        if (!isCursorCell) {
                            ctx.fillStyle = bg || this.defaultBackground;
                            Grid.fillCell(ctx, this.cellSize, [x, y]);
                        }

                        ctx.fillStyle = fg || this._defaultForeground;
                        Grid.characterCell(ctx, this.cellSize, [x, y], char, {});
                    }
                }
            }
        }

        return available;
    }

    _drawScrollBar(ctx) {
        const termHeight = this.cellSize[1] * this.numRows;
        const termWidth = this.cellSize[0] * this.numColumns;
        const barHeight = (this.numRows / this._normal.rows.length) * termHeight;
        const barY = (this._normal.rowOffset / this._normal.rows.length) * termHeight;
        ctx.fillStyle = "rgba(255, 100, 255, 0.3)"
        const barWidth = 8;
        ctx.fillRect(termWidth - barWidth, barY, barWidth, barHeight);
    }

    parseAnsiFunction(text) {
        let args = [];
        let numberString = "";
        let i = ANSI_CSI.length;
        let ansiFunction = "";

        if (text[i] == "?") {
            // Some sequences start with a ?, e.g.
            // https://gist.github.com/natanaeljr/8b26dba7b876e2c006bfa28a4147b407#file-escape_code-h-L88
            ansiFunction = "?";
            i ++;
        }

        while(true) {
            if ("0123456789".includes(text[i])) {
                numberString += text[i];
            } else {
                args.push(Number.parseInt(numberString));
                numberString = "";
                if (text[i] != ";") {
                    break;
                }
            } 
            i++;
        }
        ansiFunction += text[i];
        const matched = i + 1;
        return {ansiFunction, args, matched};
    }

    insert(text) {

        let consumed = 0;

        while (text != "") {

            if (text.startsWith(ANSI_CSI)) {
                let {ansiFunction, args, matched} = this.parseAnsiFunction(text);
                text = text.slice(matched);
                consumed += matched;
                if (ansiFunction == "C") {
                    this._cursorForward();
                } else if (ansiFunction == "D") {
                    this._cursorBack();
                } else if (ansiFunction == "G") {
                    this._setCursorColClamped(args[0] - 1);
                } else if (ansiFunction == "H") {
                    this._setCursorClamped(args[1] - 1, args[0] - 1);
                } else if (ansiFunction == "J") {
                    // https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
                    if (args[0] == 2) {
                        // note: although this terminal is happy with just (3),
                        //       other terminals like Windows PowerShell seem
                        //       to need (2) to have the desired effect.
                        // Ps = 2  ⇒  Selective Erase All.
                        this._clear();
                    } else if (args[0] == 3) {
                        // Ps = 3  ⇒  Selective Erase Saved Lines, xterm.
                        this._clear();
                    } else {
                        assert(false, `unhandled ansi erase function: J(${args})`);
                    }
                } else if (ansiFunction == "K") {
                    // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#erase-functions
                    if (args[0] == 0) {
                        this._eraseLineToEnd();
                    } else if (args[0] == 2) {
                        this._eraseEntireLine();
                    } else {
                        assert(false, `unhandled ansi erase function: K(${args})`);
                    }
                } else if (ansiFunction == "m") {
                    // SGR (Select Graphic Rendition)
                    // https://chrisyeh96.github.io/2020/03/28/terminal-colors.html
                    // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#8-16-colors    

                    const foregrounds = {
                        30: "black",
                        31: "red",
                        32: "green",
                        33: "yellow",
                        34: "blue",
                        35: "magenta",
                        36: "cyan",
                        37: "white",
                        39: null
                    };

                    const backgrounds = {
                        40: "black",
                        41: "red",
                        42: "green",
                        43: "yellow",
                        44: "blue",
                        45: "magenta",
                        46: "cyan",
                        47: "white",
                        49: null
                    };

                    let fg = undefined;
                    let bg = undefined;

                    for (let arg of args) {
                        if (arg in foregrounds) {
                            fg = foregrounds[arg];
                        } else if (arg in backgrounds) {
                            bg = backgrounds[arg];
                        } else {
                            assert(false, `Unhandled SGR arg: '${arg}'`);
                        }
                    }

                    const config = this._normalMode ? this._normal : this._alternate;

                    if (fg !== undefined) {
                        config.fg = fg;
                    }
                    if (bg !== undefined) {
                        config.bg = bg;
                    }

                } else if (ansiFunction == "?h") {
                    if (args[0] == 1049) {
                        // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#common-private-modes
                        this._enterAlternate();
                    } else {
                        assert(false, "support more ansi ?h functions");
                    }
                } else if (ansiFunction == "?l") {
                    if (args[0] == 1049) {
                        // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#common-private-modes
                        this._exitAlternate();
                    } else {
                        assert(false, "support more ansi ?l functions");
                    }
                } else {
                    // Unhandled ansi function
                    return {ansiFunction, args, consumed, matched};
                }
            } else {
                const ch = text[0];
                if (ch == "\n") {
                    this._newline();
                } else if (ch == ASCII_CARRIAGE_RETURN) {
                    if (this._normalMode) {
                        this._normal.doc.cursorStartOfLine();
                    } else {
                        this._alternate.cursor[0] = 0;
                    }
                } else if (ch == ASCII_BACKSPACE) {
                    if (this._normalMode) {
                        this._normal.doc.eraseWithinLine();
                    } else {
                          // https://unix.stackexchange.com/a/414246
                        if (this._alternate.cursor[0] > 0) {
                            this._alternate.cursor[0] --;
                        }
                    }
                } else {
                    const config = this._normalMode ? this._normal : this._alternate;
                    const value = {char: ch, fg: config.fg, bg: config.bg};
                    if(this._normalMode) {
                        this._normal.doc.insert(value);
                    } else {
                        this._alternate.rows[this._alternate.cursor[1]][this._alternate.cursor[0]] = value;
                        if (this._alternate.cursor[0] < this.numColumns - 1) {
                            this._alternate.cursor[0] ++;
                        } else {
                            this._newline();
                        }
                    }

                }

                // Make sure the bottom row is shown, upon user interaction
                this._normal.rowOffset = Math.max(this._normal.rows.length - this.numRows, 0);

                text = text.slice(1);
                consumed ++;
            } 

        }
    }

    _newline() {
        if (this._normalMode) {
            this._normal.doc.cursorEndOfLine();
            this._normal.doc.addLinefeed();
            this._recalculateNormal();
            
        } else {
            if (this._alternate.cursor[1] < this.numRows - 1) {
                this._alternate.cursor[1] ++;
                this._alternate.cursor[0] = 0;
            }
        }
    }

    _cursorForward() {
        if (this._normalMode) {
            this._normal.doc.cursorRight();
        } else {
            this._alternate.cursor[0] = Math.min(this._alternate.cursor[0] + 1, this.numColumns - 1);
        }
    }

    _cursorBack() {
        if (this._normalMode) {
            this._normal.doc.cursorLeftWithinLine();
        } else {
            this._alternate.cursor[0] = Math.max(this._alternate.cursor[0] - 1, 0);
        }
    }

    _setCursorColClamped(col) {
        if (this._normalMode) {
            this._normal.doc.setCursorInLine(col);
        } else {
            this._alternate.cursor[0] = Math.min(col, this.numColumns - 1);
        }
    }

    _setCursorRowClamped(row) {
        console.assert(!this._normalMode);
        this._alternate.cursor[1] = Math.min(row, this.numRows - 1);
    }

    _setCursorClamped(col, row) {
        this._setCursorColClamped(col);
        this._setCursorRowClamped(row);
    }

    _clear() {
        if (this._normalMode) {
            this._normal.doc.clear();
        } else {
            this._initAlternateBuffer();
        }
    }

    _eraseEntireLine() {
        if (this._normalMode) {
            this._normal.doc.eraseEntireLine()
        } else {
            for (let col = 0; col < this.numColumns; col ++) {
                this._alternate.rows[this._alternate.cursor[1]][col] = null;
            }
        }
    }

    _eraseLineToEnd() {
        if (this._normalMode) {
            this._normal.doc.eraseLineToEnd()
        } else {
            for (let col = this._alternate.cursor[0]; col < this.numColumns; col ++) {
                this._alternate.rows[this._alternate.cursor[1]][col] = null;
            }
        }
    }
}
