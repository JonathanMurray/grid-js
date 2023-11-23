"use strict";

class Sudoku {
    constructor(canvas, startingNumbers) {

        if (startingNumbers == undefined) {
            const start = "" +
            "+---+---+---+" +
            "|   |   |  5|" +
            "|7 6|4 1| 2 |" +
            "|5 9|7 3|48 |" +
            "+---+---+---+" +
            "|1  |3  | 7 |" +
            "| 2 |  8|5 9|" +
            "|4 3|2 9|8  |" +
            "+---+---+---+" +
            "| 72| 9 |   |" +
            "|   |  2| 97|" +
            "|9 5|81 |34 |" +
            "+---+---+---+";
            startingNumbers = Sudoku.parseSudoku(start);
        }

        this.startingNumbers = startingNumbers;
        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
        this._lines = [];

        for (let row = 0; row <= 9; row += 3) {
            this._lines.push([0, row, 9, row]);
        }
        for (let col = 0; col <= 9; col += 3) {
            this._lines.push([col, 0, col, 9]);
        }

        this._characterRows = [];
        for (let y = 0; y < 9; y++) {
            this._characterRows.push(new Array(9));
        }

        this.mouseCell;

        this._numColumns = 9;
        this._numRows = 9;

        this._cellSize = [Math.floor(canvas.width / this._numColumns), Math.floor(canvas.height / this._numRows)];

       
        for (let col = 0; col < 9; col++) {
            for (let row = 0; row < 9; row++) {
                const startingNumber = this.startingNumber(col, row);
                if (startingNumber != null) {
                    this._characterRows[row][col] = startingNumber;
                }
            }
        }

        this.draw();
    }

    draw() {

        this._ctx.fillStyle = "white";
        this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);
        Grid.cellLines(this._ctx, this._cellSize, this._lines);

        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                if (this.mouseCell && this.mouseCell[0] == x && this.mouseCell[1] == y) {
                    this._ctx.fillStyle = "#AAFFFF";
                    Grid.fillCell(this._ctx, this._cellSize, [x, y]);
                }

                const ch = this._characterRows[y][x];
                if (ch != null) {
                    
               
                    if (this.startingNumber(x, y) != null) {
                        this._ctx.fillStyle = "green";
                    } else {
                        this._ctx.fillStyle = "black";
                    }
                    
                    Grid.characterCell(this._ctx, this._cellSize, [x, y], ch);
                }
            }
        }

        this._ctx.strokeStyle = "black";
        Grid.outlineCells(this._ctx, this._cellSize, [9, 9]);

    }

    handleEvent(name, event) {
        if (name == "mousemove") {
            this.setMouseCell(Grid.pixelToCell([event.x, event.y], this._cellSize, [9, 9]));
        } else if (name == "click") {
            const cell = Grid.pixelToCell([event.x, event.y], this._cellSize, [9, 9]);
            if (cell !== null) {
                const [col, row] = cell;
                if (this.startingNumber(col, row) == null) {
                    //delete this.grid.characters[col][row];
                    delete this._characterRows[row][col];
                    this.draw();
                    this.validate();
                }
            }
        } else if (name == "keydown") {
            const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            const isNumeric = NUMBERS.indexOf(event.key) > -1;
            if (this.mouseCell != null && isNumeric && this.startingNumber(this.mouseCell[0], this.mouseCell[1]) == null) {
                this._characterRows[this.mouseCell[1]][this.mouseCell[0]] = event.key;
                this.draw();
                this.validate();
            }
        } else if (name == "mouseout") {
            this.setMouseCell(null);
        }
    }

    setMouseCell(cell) {
        this.mouseCell = cell;
        this.draw();
    }

    startingNumber(col, row) {
        if (col in this.startingNumbers && row in this.startingNumbers[col]) {
            return this.startingNumbers[col][row];
        }
        return null;
    }

    validate() {
        if (this.isValid()) {
            
        } else {
            console.log("Incorrect solution! Duplicate found.")
        }
    }

    isValid() {
        // No repeated numbers in columns
        for (let col = 0; col < 9; col ++) {
            let chars = new Set();
            for (let row = 0; row < 9; row ++) {
                const ch = this._characterRows[row][col];
                if (ch != null) {
                    if (chars.has(ch)) {
                        return false;
                    }
                    chars.add(ch);
                }
            }
        }

        // No repeated numbers in rows
        for (let row = 0; row < 9; row ++) {
            let chars = new Set();
            for (let col = 0; col < 9; col ++) {
                const ch = this._characterRows[row][col];
                if (ch != null) {
                    if (chars.has(ch)) {
                        return false;
                    }
                    chars.add(ch);
                }
            }
        }

        // No repeated numbers in blocks
        for (let col0 = 0; col0 < 9; col0 += 3) {
            for (let row0 = 0; row0 < 9; row0 += 3) {
                let chars = new Set();
                for (let i = 0; i < 3; i++) {
                    const col = col0 + i;
                    for (let j = 0; j < 3; j++) {
                        const row = row0 + j;
                        const ch = this._characterRows[row][col];
                        if (ch != null) {
                            if (chars.has(ch)) {
                                return false;
                            }
                            chars.add(ch);
                        }
                    }
                }
            }
        }

        return true;
    }

        
    static parseSudoku(start) {
        const startingNumbers = [];
        for (let col = 0; col < 9; col ++) {
            startingNumbers.push(new Array(9));
        }

        let template;

        let row = 0;
        let col = 0;

        if (start.length == 325) {
            template = "" +
            "+ - - - + - - - + - - - +" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "+ - - - + - - - + - - - +" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "+ - - - + - - - + - - - +" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "| x x x | x x x | x x x |" +
            "+ - - - + - - - + - - - +";
        } else if(start.length == 169) {
            template = "" +
            "+---+---+---+" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "+---+---+---+" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "+---+---+---+" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "|xxx|xxx|xxx|" +
            "+---+---+---+";
        } else if (start.length == 81) {
            template = "" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx" +
            "xxxxxxxxx";
        }
        console.assert(template, "Bad sudoku string", start);

        for (let i = 0; i < start.length; i++) {
            const ch = start.charAt(i);
            const isNumeric = ch.charCodeAt() >= 49 && ch.charCodeAt() <= 57;
            if (template.charAt(i) == 'x') {
                if (isNumeric) {
                    startingNumbers[col][row] = ch;
                }
                col ++;
                if (col == 9) {
                    col = 0;
                    row ++;
                }
            }
        } 
        console.assert(row == 9, row);
        return startingNumbers;
    }
}

async function main(args) {

    let resolvePromise;
    let programDonePromise = new Promise((r) => {resolvePromise = r;});

    const window = await stdlib.createWindow("Sudoku", [300, 300], {resizable: false});
    const app = new Sudoku(window.canvas);

    window.onkeydown = (event) => {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Sudoku shutting down").finally(resolvePromise);
        } else {
            app.handleEvent("keydown", event);
        }
    };

    window.onclick = (event) => {
        app.handleEvent("click", event);
    };
    
    window.onmousemove = (event) => {
        app.handleEvent("mousemove", event);
    };

    window.onmouseout = (event) => {
        app.handleEvent("mouseout", event);
    };

    return programDonePromise;
}
