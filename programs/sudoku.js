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

        this.canvas = canvas;
        this.startingNumbers = startingNumbers;
        this.grid = new Grid(canvas, {numColumns:9, numRows:9, xOffset: 1, yOffset: 1});
        const grid = this.grid;

        for (let row = 0; row <= 9; row += 3) {
            grid.lines.push([0, row, 9, row]);
        }
        for (let col = 0; col <= 9; col += 3) {
            grid.lines.push([col, 0, col, 9]);
        }

        this.mouseCell;


        grid.forEachCell((col, row) => {
            const startingNumber = this.startingNumber(col, row);
            if (startingNumber != null) {
                grid.foregrounds[col][row] = "green";
                grid.characters[col][row] = startingNumber;
            }
        });

        grid.draw();
    }

    handleEvent(name, event) {
        if (name == "mousemove") {
            this.setMouseCell(this.grid.pixelToCell(event.offsetX, event.offsetY));
        } else if (name == "click") {
            const cell = this.grid.pixelToCell(event.offsetX, event.offsetY);
            if (cell !== null) {
                const [col, row] = cell;
                if (this.startingNumber(col, row) == null) {
                    delete this.grid.characters[col][row];
                    this.grid.draw();
                    this.validate();
                }
            }
        } else if (name == "keydown") {
            const NUMBERS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            const isNumeric = NUMBERS.indexOf(event.key) > -1;
            if (this.mouseCell != null && isNumeric && this.startingNumber(this.mouseCell[0], this.mouseCell[1]) == null) {
                this.grid.characters[this.mouseCell[0]][this.mouseCell[1]] = event.key;
                this.grid.draw();
                this.validate();
            }
        } else if (name == "mouseout") {
            this.setMouseCell(null);
        }
    }

    setMouseCell(cell) {
        this.mouseCell = cell;
        this.grid.forEachCell((col, row) => delete this.grid.backgrounds[col][row]);
        if (this.mouseCell !== null) {
            let [col, row] = this.mouseCell;
            this.grid.backgrounds[col][row] = "#AAFFFF";
        } 
        this.grid.draw();
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
                let ch = this.grid.characterAt(col, row);
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
                let ch = this.grid.characterAt(col, row);
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
                        let ch = this.grid.characterAt(col, row);
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

    const size = [300, 300];

    await syscall("graphics", {title: "Sudoku", size: [size[0] + 30, size[1] + 20]});

    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.style.outline = "1px solid black";
    document.getElementsByTagName("body")[0].appendChild(canvas);

    const app = new Sudoku(canvas);

    window.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Sudoku shutting down").finally(resolvePromise);
        } else {
            app.handleEvent("keydown", event);
        }
    });

    window.addEventListener("click", (event) => {
        app.handleEvent("click", event);
    });

    window.addEventListener("mousemove", (event) => {
        app.handleEvent("mousemove", event);
    });

    window.addEventListener("mouseout", (event) => {
        app.handleEvent("mouseout", event);
    });



    return programDonePromise;
}
