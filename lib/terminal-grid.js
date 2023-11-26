"use strict";

const CURSOR_COLOR = "#666";

class TerminalGrid {
    // https://unix.stackexchange.com/questions/145050/what-exactly-is-scrollback-and-scrollback-buffer
    // https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-The-Alternate-Screen-Buffer

    constructor(size) {

        this._numColumns = size[0];
        this._numRows = size[1];

        this._normalMode = true;

        this._initAlternateRows();
        this._cx = 0; // cursor x, i.e. col index
        this._cy = 0; // cursor y, i.e. row index

        this._normalDoc = new DocumentWithCursor();
        this._normalRows = [];
        this._normalCursor = [0, 0];
        this._rowOffset = 0;
    }

    _initAlternateRows() {
        this._alternateRows = [];
        for (let y = 0; y < this._numRows; y ++) {
            this._alternateRows.push(new Array(this._numColumns));
        }
    }

    resize(size) {
        this._numColumns = size[0];
        this._numRows = size[1];

        this._initAlternateRows();
    }

    _enterAlternate() {
        this._normalMode = false;
        this._initAlternateRows();
    }

    _exitAlternate() {
        this._normalMode = true;
    }

    cursorPosition() {
        return [this._cx, this._cy];
    }

    scroll(deltaY) {
        if (this._normalMode) {
            if (deltaY > 0) {
                this._rowOffset += 1;
            } else {
                this._rowOffset = Math.max(this._rowOffset - 1, 0);
            }
            return true;
        }
        return false;
    }

    _recalculateNormal() {
        const {rows, cursorRow, cursorCol} = this._normalDoc.calculateWrapped(this._numColumns);

        if(rows.length > this._normalRows.length) {
            this._rowOffset += rows.length - this._normalRows.length;
        }

        this._normalRows = rows;
        this._normalCursor = [cursorCol, cursorRow];
    }

    draw(ctx, cellSize) {

        if (this._normalMode) {
            this._recalculateNormal();

            if (this._rowOffset > this._normalRows.length - this._numRows) {
                this._rowOffset = Math.max(this._normalRows.length - this._numRows, 0);
            }

            let rowOffset = this._rowOffset;

            for (let y = rowOffset; y < this._numRows + rowOffset; y++) {
                for (let x = 0; x < this._numColumns; x ++) {
                    
                    ctx.fillStyle = "#000";
                    if (y == this._normalCursor[1] && x == this._normalCursor[0]) {
                        ctx.fillStyle = "#099";
                    }
                    Grid.fillCell(ctx, cellSize, [x, y - rowOffset]);
                    ctx.fillStyle = "#0F0";

                    if (y < this._normalRows.length && x < this._normalRows[y].length) {
                        const row = this._normalRows[y];
                        const ch = row[x];
                        Grid.characterCell(ctx, cellSize, [x, y - rowOffset], ch, {});
                    }
                }
            }

            if (this._numRows < this._normalRows.length) {
                this._drawScrollBar(ctx, cellSize);
            }

        } else {

            for (let y = 0; y < this._numRows; y++) {
                for (let x = 0; x < this._numColumns; x ++) {
                    
                    ctx.fillStyle = "#000";
                    Grid.fillCell(ctx, cellSize, [x, y]);
                    ctx.fillStyle = "#0F0";

                    const row = this._alternateRows[y];
                    const ch = row[x];
                    if (ch != null) {
                        Grid.characterCell(ctx, cellSize, [x, y], ch, {});
                    }
                }
            }
        }
    }

    _drawScrollBar(ctx, cellSize) {
        const termHeight = cellSize[1] * this._numRows;
        const termWidth = cellSize[0] * this._numColumns;
        const barHeight = (this._numRows / this._normalRows.length) * termHeight;
        const barY = (this._rowOffset / this._normalRows.length) * termHeight;
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
                    this._cx = 0;
                } else if (ch == ASCII_BACKSPACE) {

                    if (this._normalMode) {
                        this._normalDoc.erase();
                    }

                    // https://unix.stackexchange.com/a/414246
                    if (this._cx > 0) {
                        this._cx --;
                    }
                } else {

                    if(this._normalMode) {
                        this._normalDoc.insert(ch);
                    } else {
                        this._alternateRows[this._cy][this._cx] = ch;
                        if (this._cx < this._numColumns - 1) {
                            this._cx ++;
                        } else {
                            this._newline();
                        }
                    }

                }
                text = text.slice(1);
                consumed ++;
            } 

        }
    }

    _newline() {
        if (this._normalMode) {
            this._normalDoc.cursorEndOfLine();
            this._normalDoc.addLinefeed();
            this._recalculateNormal();
            this._rowOffset = Math.max(this._normalRows.length - this._numRows, 0);
        } else {
            if (this._cy < this._numRows - 1) {
                this._cy ++;
                this._cx = 0;
            }
        }
    }

    _cursorForward() {
        if (this._normalMode) {
            this._normalDoc.cursorRight();
        } else {

            this._cx = Math.min(this._cx + 1, this._numColumns - 1);
        }
    }

    _cursorBack() {
        if (this._normalMode) {
            this._normalDoc.cursorLeft();
        } else {
            this._cx = Math.max(this._cx - 1, 0);
        }
    }

    _setCursorColClamped(col) {
        this._cx = Math.min(col, this._numColumns - 1);
    }

    _setCursorRowClamped(row) {
        this._cy = Math.min(row, this._numRows - 1);
    }

    _setCursorClamped(col, row) {
        this._setCursorColClamped(col);
        this._setCursorRowClamped(row);
    }

    _clear() {
        this._initAlternateRows();
        this._cx = 0;
        this._cy = 0;
    }

    _eraseEntireLine() {
        if (this._normalMode) {
            this._normalDoc.eraseEntireLine()
        } else {
            for (let col = 0; col < this._numColumns; col ++) {
                this._alternateRows[this._cy][col] = null;
            }
        }
    }
}
