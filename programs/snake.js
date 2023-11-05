"use strict";

class Snake {

    static LEFT = [-1, 0];
    static RIGHT = [1, 0];
    static UP = [0, -1];
    static DOWN = [0, 1];

    static FRAME_DURATION = 100;
    static MARGIN_TOP = 1;

    constructor(canvas, syscalls) {
        this.syscalls = syscalls;
        const grid = new Grid(canvas, {numColumns:16, numRows:16, xOffset:1, yOffset:1});
        this.grid = grid;
        this.canvas = canvas;

        grid.showBackgroundLines = false;

        grid.lines.push([0, Snake.MARGIN_TOP, grid.numColumns, Snake.MARGIN_TOP]);
        grid.lines.push([0, grid.numRows, grid.numColumns, grid.numRows]);
        grid.lines.push([0, Snake.MARGIN_TOP, 0, grid.numRows]);
        grid.lines.push([grid.numColumns, Snake.MARGIN_TOP, grid.numColumns, grid.numRows]);
        grid.centerText = false;

        this.startGame();
        
        this.previousTimestamp;
        this.timeUntilNextFrame = Snake.FRAME_DURATION;
        
        const self = this;
        window.requestAnimationFrame(timestamp => self.step(timestamp));

        this.syscalls.write(["Use WASD or arrow keys for movement."]);
    }

    startGame() {
        this.gameOver = false;
        this.score = 0;
        this.snake = [[5, 5], [6, 5]];
        this.direction = Snake.RIGHT;
        this.commandedDirection = this.direction;
        this.food = this.findFreeCell();
        this.updateHeaderText();

        this.grid.forEachCell((col, row) => {
            delete this.grid.backgrounds[col][row];
        });
        for (let [col, row] of this.snake) {
            this.grid.backgrounds[col][row] = "red";
        }
        this.grid.backgrounds[this.food[0]][this.food[1]] = "green";
        this.grid.draw();
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            const key = event.key;
            if (key == "ArrowLeft" || key == "A" || key == "a") {
                if (this.direction != Snake.RIGHT) {
                    this.commandedDirection = Snake.LEFT;
                }
            } else if (key == "ArrowRight" || key == "D" || key == "d") {
                if (this.direction != Snake.LEFT) {
                    this.commandedDirection = Snake.RIGHT;
                }
            } else if (key == "ArrowUp" || key == "W" || key == "w") {
                if (this.direction != Snake.DOWN) {
                    this.commandedDirection = Snake.UP;
                } 
            } else if (key == "ArrowDown" || key == "S" || key == "s") {
                if (this.direction != Snake.UP) {
                    this.commandedDirection = Snake.DOWN;
                }
            }  else if (key == " ") {
                if (this.gameOver) {
                    this.startGame();
                }
            } else {
                console.log(key);
            }
        }
    }

    setHeaderText(text) {
        for (let col = 0; col < this.grid.numColumns; col ++) {
            this.grid.characters[col][0] = text.charAt(col);
        }
    }

    step(timestamp) {
        if (this.previousTimestamp != undefined) {
            if (!this.gameOver) {
                const elapsed = timestamp - this.previousTimestamp;
                this.timeUntilNextFrame -= elapsed;
                if (this.timeUntilNextFrame <= 0) {
                    this.runOneFrame();
                    this.timeUntilNextFrame += Snake.FRAME_DURATION;
                }
            }
        }
        this.previousTimestamp = timestamp;
        window.requestAnimationFrame(timestamp => this.step(timestamp)); 
    }

    updateHeaderText() {
        let text = ` ${this.score}`;
        if (this.gameOver) {
            text += " GAME OVER.";
        }
        this.setHeaderText(text)
    }

    lose() {
        this.gameOver = true;
        this.updateHeaderText();
        this.grid.draw();
        this.syscalls.write(["Game over. Press Space to play again."]);
    }

    runOneFrame() {
        const oldHead = this.snake[this.snake.length - 1];
        this.direction = this.commandedDirection;
        const newHead = this.add(oldHead, this.direction);

        if (!this.withinGameBounds(newHead)) {
            this.grid.backgrounds[oldHead[0]][oldHead[1]] = "purple";
            this.lose();
            return;
        }
        
        if (this.equals(newHead, this.food)) {
            this.score += 10;
            this.updateHeaderText();
            this.food = this.findFreeCell();
        } else {
            const removed = this.snake.shift();
            delete this.grid.backgrounds[removed[0]][removed[1]];
        }

        if (this.snakeContains(newHead)) {
            this.grid.backgrounds[newHead[0]][newHead[1]] = "purple";
            this.lose();
            return;
        }

        this.snake.push(newHead);

        for (let [col, row] of this.snake) {
            this.grid.backgrounds[col][row] = "red";
        }
        this.grid.backgrounds[this.food[0]][this.food[1]] = "green";
        this.grid.draw();
    }

    withinGameBounds(cell) {
        return (cell[0] >= 0 && cell[0] < this.grid.numColumns && 
                cell[1] >= Snake.MARGIN_TOP && cell[1] < this.grid.numRows);
    }

    findFreeCell() {
        // avoid hanging the browser tab, if we mess up
        for (let i = 0; i < 10_000; i++) {
            let randomCol = Math.floor(Math.random() * this.grid.numColumns);
            let randomRow = Snake.MARGIN_TOP + Math.floor(Math.random() * (this.grid.numRows - Snake.MARGIN_TOP));
            if (!this.snakeContains([randomCol, randomRow])) {
                return [randomCol, randomRow];
            }
        }
        console.error("Couldn't find any free cell");
    }

    snakeContains(cell) {
        for (let snakeCell of this.snake) {
            if (this.equals(snakeCell, cell)) {
                return true;
            }
        }
        return false;
    }
    
    add(a, b) {
        return [a[0] + b[0], a[1] + b[1]];
    }

    equals(a, b) {
        return a[0] == b[0] && a[1] == b[1];
    }
}

async function main(args) {

    let resolvePromise;
    let programDonePromise = new Promise((r) => {resolvePromise = r;});

    const size = [300, 300];

    await syscalls.graphics({title: "Snake", size: [size[0] + 30, size[1] + 20]});

    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.style.outline = "1px solid black";
    document.getElementsByTagName("body")[0].appendChild(canvas);
    
    const snake = new Snake(canvas, syscalls);

    window.addEventListener("keydown", function(event) {
        if (event.ctrlKey && event.key == "c") { 
            syscalls.write(["Snake shutting down"]).finally(resolvePromise);
        } else {
            snake.handleEvent("keydown", event);
        }
    });

    return programDonePromise;
}
