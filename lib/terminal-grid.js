"use strict";

const CURSOR_COLOR = "#099";

class TerminalGrid {
    // https://unix.stackexchange.com/questions/145050/what-exactly-is-scrollback-and-scrollback-buffer
    // https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-The-Alternate-Screen-Buffer

    constructor(size) {

        this._numColumns = size[0];
        this._numRows = size[1];

        this._normalMode = true;

        this._initAlternateBuffer();
        
        this._normal = {
            doc: new DocumentWithCursor(),
            rows: [],
            cursor: [0, 0],
            rowOffset: 0,
            color: null
        };

        this.defaultBackground = "#FFF";
        this._defaultForeground = "#000";
    }

    _initAlternateBuffer() {
        this._alternate = {
            rows: [],
            cx: 0, // cursor x, i.e. col index
            cy: 0, // cursor y, i.e. row index
            color: null
        };
        for (let y = 0; y < this._numRows; y ++) {
            this._alternate.rows.push(new Array(this._numColumns));
        }
    }

    setDefaultBackground(color) {
        this.defaultBackground = color;
    }

    setDefaultForeground(color) {
        this._defaultForeground = color;
    }

    resize(size) {
        this._numColumns = size[0];
        this._numRows = size[1];

        this._initAlternateBuffer();
    }

    _enterAlternate() {
        this._normalMode = false;
        this._initAlternateBuffer();
    }

    _exitAlternate() {
        this._normalMode = true;
    }

    cursorPosition() {
        return [this._alternate.cx, this._alternate.cy];
    }

    scroll(deltaY) {
        if (this._normalMode) {
            if (deltaY > 0) {
                this._normal.rowOffset += 1;
            } else {
                this._normal.rowOffset = Math.max(this._normal.rowOffset - 1, 0);
            }
            return true;
        }
        return false;
    }

    _recalculateNormal() {
        const {rows, cursorRow, cursorCol} = this._normal.doc.calculateWrapped(this._numColumns);

        if(rows.length > this._normal.rows.length) {
            this._normal.rowOffset += rows.length - this._normal.rows.length;
        }

        this._normal.rows = rows;
        this._normal.cursor = [cursorCol, cursorRow];
    }

    draw(ctx, cellSize) {

        if (this._normalMode) {
            this._recalculateNormal();

            if (this._normal.rowOffset > this._normal.rows.length - this._numRows) {
                this._normal.rowOffset = Math.max(this._normal.rows.length - this._numRows, 0);
            }

            let rowOffset = this._normal.rowOffset;

            for (let y = rowOffset; y < this._numRows + rowOffset; y++) {
                for (let x = 0; x < this._numColumns; x ++) {
                    
                    ctx.fillStyle = this.defaultBackground;
                    if (y == this._normal.cursor[1] && x == this._normal.cursor[0]) {
                        ctx.fillStyle = CURSOR_COLOR;
                    }
                    Grid.fillCell(ctx, cellSize, [x, y - rowOffset]);
                    

                    if (y < this._normal.rows.length && x < this._normal.rows[y].length) {
                        const row = this._normal.rows[y];
                        
                        const {char, color} = row[x];
                        ctx.fillStyle = color || this._defaultForeground;
                        Grid.characterCell(ctx, cellSize, [x, y - rowOffset], char, {});
                    }
                }
            }

            if (this._numRows < this._normal.rows.length) {
                this._drawScrollBar(ctx, cellSize);
            }

        } else {

            for (let y = 0; y < this._numRows; y++) {
                for (let x = 0; x < this._numColumns; x ++) {
                    
                    ctx.fillStyle = this.defaultBackground;
                    Grid.fillCell(ctx, cellSize, [x, y]);

                    const row = this._alternate.rows[y];
                    if (x in row) {
                        const {char, color} = row[x];
                            ctx.fillStyle = color || this._defaultForeground;
                            Grid.characterCell(ctx, cellSize, [x, y], char, {});
                    }
                }
            }
        }
    }

    _drawScrollBar(ctx, cellSize) {
        const termHeight = cellSize[1] * this._numRows;
        const termWidth = cellSize[0] * this._numColumns;
        const barHeight = (this._numRows / this._normal.rows.length) * termHeight;
        const barY = (this._normal.rowOffset / this._normal.rows.length) * termHeight;
        ctx.fillStyle = "rgba(255, 100, 255, 0.3)"
        const barWidth = 20;
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
                        this._clear();
                    } else {
                        assert(false, "support more ansi erase functions");
                    }
                } else if (ansiFunction == "K") {
                    if (args[0] == 2) {
                        // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#erase-functions
                        this._eraseEntireLine();
                    } else {
                        assert(false, "support more ansi erase functions");
                    }
                } else if (ansiFunction == "m") {
                    // SGR (Select Graphic Rendition)
                    // https://chrisyeh96.github.io/2020/03/28/terminal-colors.html
                    // https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797#8-16-colors    

                    const colors = {
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

                    const color = colors[args[0]];
                    if (color === undefined) {
                        assert(false, "support more ansi color/graphics functions");
                    } else {
                        if (this._normalMode) {
                            this._normal.color = color;
                        } else {
                            this._alternate.color = color;
                        }
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
                    this._alternate.cx = 0;
                } else if (ch == ASCII_BACKSPACE) {

                    if (this._normalMode) {
                        this._normal.doc.erase();
                    }

                    // https://unix.stackexchange.com/a/414246
                    if (this._alternate.cx > 0) {
                        this._alternate.cx --;
                    }
                } else {

                    if(this._normalMode) {
                        this._normal.doc.insert({char: ch, color: this._normal.color});
                    } else {
                        this._alternate.rows[this._alternate.cy][this._alternate.cx] = {char: ch, color: this._alternate.color};
                        if (this._alternate.cx < this._numColumns - 1) {
                            this._alternate.cx ++;
                        } else {
                            this._newline();
                        }
                    }

                }

                // Make sure the bottom row is shown, upon user interaction
                this._normal.rowOffset = Math.max(this._normal.rows.length - this._numRows, 0);

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
            if (this._alternate.cy < this._numRows - 1) {
                this._alternate.cy ++;
                this._alternate.cx = 0;
            }
        }
    }

    _cursorForward() {
        if (this._normalMode) {
            this._normal.doc.cursorRight();
        } else {

            this._alternate.cx = Math.min(this._alternate.cx + 1, this._numColumns - 1);
        }
    }

    _cursorBack() {
        if (this._normalMode) {
            this._normal.doc.cursorLeft();
        } else {
            this._alternate.cx = Math.max(this._alternate.cx - 1, 0);
        }
    }

    _setCursorColClamped(col) {
        if (this._normalMode) {
            this._normal.doc.setCursorInLine(col);
        } else {
            this._alternate.cx = Math.min(col, this._numColumns - 1);
        }
    }

    _setCursorRowClamped(row) {
        this._alternate.cy = Math.min(row, this._numRows - 1);
    }

    _setCursorClamped(col, row) {
        this._setCursorColClamped(col);
        this._setCursorRowClamped(row);
    }

    _clear() {
        this._initAlternateBuffer();
        this._alternate.cx = 0;
        this._alternate.cy = 0;
    }

    _eraseEntireLine() {
        if (this._normalMode) {
            this._normal.doc.eraseEntireLine()
        } else {
            for (let col = 0; col < this._numColumns; col ++) {
                this._alternate.rows[this._alternate.cy][col] = null;
            }
        }
    }
}
