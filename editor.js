"use strict";

class Editor {
    static HIGHLIGHT = "#BBDDFF";
    static HIGHLIGHT_FADED = "#EEEEEE";

    constructor(canvas) {
        const grid = new Grid(canvas, {cellSize:[10, 16], xOffset:1, yOffset:1});
        this.grid = grid;
        this.canvas = canvas;
      
        this.col = 0;
        this.row = 0;

        this.cursorLine = 0;
        this.cursorChar = 0;
        this.lines = [""];
        this.focused = false;
        this.highlight = Editor.HIGHLIGHT;

        grid.centerText = false;
        grid.showBackgroundLines = false;


        for (let ch of "Hello. This is a demo.") {
            this.insertKey(ch);
        }
        this.update();

    }

    setFocused(focused) {
        if (focused) {
            this.highlight = Editor.HIGHLIGHT;
        } else {
            this.highlight = Editor.HIGHLIGHT_FADED;
        }
        this.update();
    }


    handleEvent(name, event) {
        if (name == "keydown") {
            const key = event.key;
            if (key == "Backspace") {
                this.backspace();
            } else if (key == "Enter") {
                this.insertLineBreak();
            } else if (key == "ArrowLeft") {
                this.moveLeft();
            } else if (key == "ArrowRight") {
                this.moveRight();
            } else if (key == "ArrowUp") {
                this.moveUp();
            } else if (key == "ArrowDown") {
                this.moveDown();
            } else if (key == "Home") {
                this.moveToStartOfLine();
            } else if (key == "End") {
                this.moveToEndOfLine();
            } else if (key.length == 1) {
                this.insertKey(key);
            } else {
                console.log(key);
            }

            this.update();
        }
    }

    update() {
        this.grid.forEachCell((col, row) => {
            delete this.grid.backgrounds[col][row];
            delete this.grid.characters[col][row];
        });

        let row = 0;
        let col = 0;
        for (let lineIdx = 0; lineIdx < this.lines.length; lineIdx ++) {
            const line = this.lines[lineIdx];
            for (let charIdx = 0; charIdx < line.length; charIdx ++) {
                const ch = line[charIdx];
                this.grid.characters[col][row] = ch;
                if (lineIdx == this.cursorLine && charIdx == this.cursorChar) {
                    this.grid.backgrounds[col][row] = this.highlight;
                }
                col ++;
                if (col >= this.grid.numColumns) {
                    row ++;
                    col = 0;
                }
            }

            if (lineIdx == this.cursorLine && this.cursorChar == line.length) {
                this.grid.backgrounds[col][row] = this.highlight;
            }

            row ++;
            col = 0;
        }

        this.grid.draw();
    }

    insertKey(key) {
        this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar) + 
                                      key + 
                                      this.lines[this.cursorLine].slice(this.cursorChar)); 
        this.cursorChar ++;
    }

    backspace() {
        if (this.cursorChar > 0) {
            this.cursorChar --;
            this.lines[this.cursorLine] = (this.lines[this.cursorLine].slice(0, this.cursorChar) + 
                                      this.lines[this.cursorLine].slice(this.cursorChar + 1)); 
        } else if (this.cursorLine > 0) {
            this.cursorLine --;
            this.cursorChar = this.lines[this.cursorLine].length;
            this.lines[this.cursorLine] = this.lines[this.cursorLine] + this.lines[this.cursorLine + 1];
            this.lines.splice(this.cursorLine + 1, 1);
        }
    }

    insertLineBreak() {
        this.lines = (this.lines.slice(0, this.cursorLine).concat(
                        [this.lines[this.cursorLine].slice(0, this.cursorChar)]).concat( 
                            [this.lines[this.cursorLine].slice(this.cursorChar)]).concat(
                                this.lines.slice(this.cursorLine + 1)));
        this.cursorLine ++;
        this.cursorChar = 0;
    }

    moveRight() {
        if (this.cursorChar < this.lines[this.cursorLine].length) {
            this.cursorChar ++;
        } else if (this.cursorLine < this.lines.length - 1) {
            this.cursorLine ++;
            this.cursorChar = 0;
        }
    }

    moveLeft() {
        if (this.cursorChar > 0) {
            this.cursorChar --;
        } else if (this.cursorLine > 0) {
            this.cursorLine --;
            this.cursorChar = this.lines[this.cursorLine].length;
        }
    }

    moveUp() {
        if (this.cursorLine > 0) {
            this.cursorLine --;
            this.cursorChar = Math.min(this.lines[this.cursorLine].length, this.cursorChar);
        } else {
            this.cursorChar = 0;
        }
    }

    moveDown() {
        if (this.cursorLine < this.lines.length - 1) {
            this.cursorLine ++;
            this.cursorChar = Math.min(this.lines[this.cursorLine].length, this.cursorChar);
        } else {
            this.cursorChar = this.lines[this.cursorLine].length;
        }
    }

    moveToStartOfLine() {
        this.cursorChar = 0;
    }

    moveToEndOfLine() {
        this.cursorChar = this.lines[this.cursorLine].length;
    }
}


