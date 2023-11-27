class DocumentWithCursor {
    constructor(lines, cursorLine, cursorChar) {
        this.lines = lines || [[]];
        this.cursorLine = cursorLine || 0;
        this.cursorChar = cursorChar || 0;
    }

    erase() {
        if (this.cursorChar > 0) {
            this.eraseWithinLine();
            return true;
        } else if (this.cursorLine > 0) {
            this.cursorLine --;
            this.cursorChar = this.lines[this.cursorLine].length;
            this.lines[this.cursorLine] = (this.lines[this.cursorLine] 
                                           .concat(this.lines[this.cursorLine + 1]));
            this.lines.splice(this.cursorLine + 1, 1);
            return true;
        }
        return false;
    }

    eraseWithinLine() {
        if (this.cursorChar > 0) {
            this.cursorChar --;
            this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar)
                                            .concat(this.lines[this.cursorLine].slice(this.cursorChar + 1)));
        }
    }

    eraseEntireLine() {
        this.lines[this.cursorLine] = [];
        this.cursorChar = 0;
    }

    eraseLineToEnd() {
        this.lines[this.cursorLine] = this.lines[this.cursorLine].slice(0, this.cursorChar);
    }

    insert(text) {
        this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar)
                                        .concat(text)
                                        .concat(this.lines[this.cursorLine].slice(this.cursorChar))
                                      ); 
        if (typeof text == "object") {
            this.cursorChar += 1;
        } else if (typeof text == "string") {
            this.cursorChar += text.length;
        } else {
            console.error(`Inserting unexpected value into document: ${JSON.stringify(text)}`);
        }
    }

    addLinefeed() {
        const lineIdx = this.cursorLine;
        const charIdx = this.cursorChar;
        this.lines = (this.lines.slice(0, lineIdx).concat(
                        [this.lines[lineIdx].slice(0, charIdx)]).concat( 
                            [this.lines[lineIdx].slice(charIdx)]).concat(
                                this.lines.slice(lineIdx + 1)));
        this.cursorLine ++;
        this.cursorChar = 0;
    }

    
    setCursorInLine(col) {
        this.cursorChar = Math.min(Math.max(col, 0), this.lines[this.cursorLine].length);
    }

    cursorRight() {
        if (this.cursorChar < this.lines[this.cursorLine].length) {
            this.cursorChar ++;
        } else if (this.cursorLine < this.lines.length - 1) {
            this.cursorLine ++;
            this.cursorChar = 0;
        }
    }

    cursorLeft() {
        if (this.cursorChar > 0) {
            this.cursorChar --;
        } else if (this.cursorLine > 0) {
            this.cursorLine --;
            this.cursorChar = this.lines[this.cursorLine].length;
        }
    }

    cursorLeftWithinLine() {
        if (this.cursorChar > 0) {
            this.cursorChar --;
        } 
    }

    cursorUp() {
        if (this.cursorLine > 0) {
            this.cursorLine --;
            // Maintain the hor. cursor position, as much as possible
            this.cursorChar = Math.min(this.lines[this.cursorLine].length, this.cursorChar);
        } else {
            this.cursorStartOfLine();
        }
    }

    cursorDown() {
        if (this.cursorLine < this.lines.length - 1) {
            this.cursorLine ++;
            // Maintain the hor. cursor position, as much as possible
            this.cursorChar = Math.min(this.lines[this.cursorLine].length, this.cursorChar);
        } else {
            this.cursorEndOfLine();
        }
    }

    cursorStartOfLine() {
        this.cursorChar = 0;
    }

    cursorEndOfLine() {
        this.cursorChar = this.lines[this.cursorLine].length;
    }

    calculateWrapped(width) {
        let rows = [];
        let cursorCol;
        let cursorRow;
        let lineBeginnings = []; // Indices of rows that correspond to the beginning of a line (i.e. are not continuations).
        for (let lineIdx = 0; lineIdx < this.lines.length; lineIdx ++) {
            let line = this.lines[lineIdx];

            // Prepare for calculating the new cursor location
            if (lineIdx == this.cursorLine) {
                cursorRow = rows.length;
            }

            lineBeginnings.push(rows.length);

            // Split up too long lines into separate rows
            while (line.length > width) {
                rows.push(line.slice(0, width));
                line = line.slice(width);
            }
            rows.push(line);

            // Calculate the cursor location in the grid
            if (lineIdx == this.cursorLine) {
                cursorCol = this.cursorChar;
                while (cursorCol > width) {
                    cursorRow ++;
                    cursorCol -= width;
                }
                if (cursorCol == width) {
                    cursorRow ++;
                    cursorCol = 0;
                    if (cursorRow >= rows.length) {
                        // The cursor is just after the last line which spans all columns. Therefore, one additional row is needed to show it.
                        rows.push([]);
                    }
                }
            }
        }

        return {rows, cursorRow, cursorCol, lineBeginnings};
    }


    debug() {
        let s = "\n";
        for (let i = 0; i < this.lines.length; i++) {
            
            s += this.lines[i] + "\n";
            if (i == this.cursorLine) {
                for (let j = 0; j < this.cursorChar; j++) {
                    s += " ";
                }
                s += "^\n";
            }
        }
        console.info(s);
    }
}


/*
let d = new DocumentWithCursor();
d.insert("Hello");
d.debug();
d.addLinefeed();
d.debug();
d.insert("World.");

d.debug();
d.cursorLeft();
d.debug();
d.erase();
d.debug();
d.cursorUp();
d.insert(" Here is some long text");
d.addLinefeed();
d.insert(" and some more...");
d.debug();

const wrapped = d.calculateWrapped(10);
console.log(wrapped);

let lineNum = 0;
let prefixedLines = [];
for (let i = 0; i < wrapped.rows.length; i++) {
    if (wrapped.lineBeginnings.includes(i)) {
        lineNum ++;
        prefixedLines.push(`${(lineNum + ": ").padEnd(4)}${wrapped.rows[i]}`);
    } else {
        prefixedLines.push(`    ${wrapped.rows[i]}`);
    }
}

const w = new DocumentWithCursor(prefixedLines, wrapped.cursorRow, wrapped.cursorCol + 4);
console.log(w);
w.debug();
*/