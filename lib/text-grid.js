"use strict";

class TextGrid {
    static HIGHLIGHT = "#BBDDFF";
    static HIGHLIGHT_FADED = "#EEEEEE";

    constructor(canvas, cellSize) {
        if (cellSize == undefined) {
            cellSize = [9, 16];
        }
        const grid = new Grid(canvas, {cellSize,  xOffset:1, yOffset:1});
        this.grid = grid;

        this.canvas = canvas;
      
        this.cursorLine = 0;
        this.cursorChar = 0;
        this.lines = [""];
        this.focused = false;
        this.highlight = TextGrid.HIGHLIGHT;

        grid.centerText = false;
        grid.showBackgroundLines = false;

        this.background = null;
        this.textStyle = null;

        this.draw();
    }

    resize(width, height) {
        this.grid.resizeCanvasWhileMaintainingCellSize(width, height);
        this.grid.forEachCell((col, row) => {
            this.grid.foregrounds[col][row] = this.textStyle;
        });
        this.draw();
    }

    clear() {
        this.cursorLine = 0;
        this.cursorChar = 0;
        this.lines = [""];
        this.draw();
    }

    setTextStyle(style) {
        this.textStyle = style;
        this.grid.forEachCell((col, row) => {
            this.grid.foregrounds[col][row] = style;
        });
    }

    setBackgroundStyle(style) {
        this.background = style;
        this.grid.background = style;
    }

    setFocused(focused) {
        if (focused) {
            this.highlight = TextGrid.HIGHLIGHT;
        } else {
            this.highlight = TextGrid.HIGHLIGHT_FADED;
        }
        this.draw();
    }

    draw() {
        console.assert(this.cursorChar <= this.lines[this.cursorLine].length, `cursor char ${this.cursorChar} > line length ${this.lines[this.cursorLine].length}. cursor line: ${this.cursorLine}`);

        // Our text "lines" need to be expressed as "rows" (i.e. be text-wrapped) for grid rendering.
        let {rows, cursorCol, cursorRow} = this.calculateGrid();

        console.assert(rows.length <= this.grid.numRows, `Too many rows to fit on grid: ${rows.length}`);
        console.assert(0 <= cursorCol && cursorCol < this.grid.numColumns, `Bad column index: ${cursorCol}`);
        console.assert(0 <= cursorRow && cursorRow < this.grid.numRows, `Bad row index: ${cursorRow}`);
        
        this.grid.forEachCell((col, row) => {
            this.grid.backgrounds[col][row] = this.background;
            delete this.grid.characters[col][row];
        });

        this.grid.backgrounds[cursorCol][cursorRow] = this.highlight;

        for (let row = 0; row < rows.length; row ++) {
            const rowChars = rows[row];
            for (let col = 0; col < rowChars.length; col ++) {
                const ch = rowChars[col];
                this.grid.characters[col][row] = ch;
            }
        }

        this.grid.draw();
    }

    calculateGrid() {
        
        let rows = [];
        let cursorCol;
        let cursorRow;
        for (let lineIdx = 0; lineIdx < this.lines.length; lineIdx ++) {
            let line = this.lines[lineIdx];

            // Prepare for calculating the cursor location in the grid
            if (this.cursorLine == lineIdx) {
                cursorRow = rows.length;
            }

            // Split up too long lines into separate rows
            while (line.length > this.grid.numColumns) {
                rows.push(line.slice(0, this.grid.numColumns));
                line = line.slice(this.grid.numColumns);
            }
            rows.push(line);

            // Calculate the cursor location in the grid
            if (this.cursorLine == lineIdx) {
                cursorCol = this.cursorChar;
                while (cursorCol > this.grid.numColumns) {
                    cursorRow ++;
                    cursorCol -= this.grid.numColumns;
                }
                if (cursorCol == this.grid.numColumns) {
                    cursorRow ++;
                    cursorCol = 0;
                    if (cursorRow >= rows.length) {
                        // The cursor is just after the last line which spans all columns. Therefore, one additional row is needed to show it.
                        rows.push("");
                    }
                }
            }
        }

        // Scroll (from start) until the cursor is among the shown rows
        while (cursorRow >= this.grid.numRows) {
            rows.splice(0, 1);
            cursorRow --;
        }

        return {rows, cursorCol, cursorRow};
    }

    insertInLine(text) {
        this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar) + 
                                      text + 
                                      this.lines[this.cursorLine].slice(this.cursorChar)); 
        this.cursorChar += text.length;
    }

    eraseInLine() {
        this.cursorChar --;
        this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar) + 
                                    this.lines[this.cursorLine].slice(this.cursorChar + 1)); 
    }

    setLine(line, cursorChar) {
        this.lines[this.cursorLine] = line;
        this.cursorChar = cursorChar;
    }

    moveToStartOfLine() {
        this.cursorChar = 0;
    }

    moveToEndOfLine() {
        this.cursorChar = this.lines[this.lines.length - 1].length;
    }

    moveToColumnIndex(index) {
        this.cursorChar = Math.min(index, this.lines[this.lines.length - 1].length)
    }
}

