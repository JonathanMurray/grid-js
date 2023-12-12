"use strict";

import { Grid } from "/lib/grid.mjs";
import { createWindow, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

class Snake {

    static LEFT = [-1, 0];
    static RIGHT = [1, 0];
    static UP = [0, -1];
    static DOWN = [0, 1];

    static FRAME_DURATION = 100;
    static MARGIN_TOP = 1;

    constructor(canvas) {
        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
        
        this._numColumns = 16;
        this._numRows = 16;
        this._cellSize = [Math.floor(canvas.width / this._numColumns), Math.floor(canvas.height / this._numRows)];

        this._headerText = "";

        this._lines = [];
        this._lines.push([0, Snake.MARGIN_TOP, this._numColumns, Snake.MARGIN_TOP]);
        this._lines.push([0, this._numRows, this._numColumns, this._numRows]);
        this._lines.push([0, Snake.MARGIN_TOP, 0, this._numRows]);
        this._lines.push([this._numColumns, Snake.MARGIN_TOP, this._numColumns, this._numRows]);

        this.resetGameState();
        
        this.timeUntilNextFrame = Snake.FRAME_DURATION;

        this._bufferedRestartCommand = false;
        
        writeln("Use WASD or arrow keys for movement.");
    }

    resize(width, height) {
        this._canvas.width = width;
        this._canvas.height = height;
        
        this.draw();
    }

    resetGameState() {
        this.gameOver = false;
        this.score = 0;
        this.snake = [[5, 5], [6, 5]];
        this.direction = Snake.RIGHT;
        this.commandedDirection = this.direction;
        this.food = this.findFreeCell();
        this.updateHeaderText();
        this._crashPosition = null;

        this.draw();
    }

    handleKeydown(event) {
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
                this.restart();
            }
        }
    }

    restart() {
        this._bufferedRestartCommand = true;
    }

    async run() {
        while (true) {
            if (!this.gameOver) {
                this.runOneFrame();
            }
           
            await syscall("sleep", {millis: Snake.FRAME_DURATION});
            
            if (this._bufferedRestartCommand) {
                this._bufferedRestartCommand = false;
                this.resetGameState();
            }
        }
    }

    updateHeaderText() {
        let text = ` ${this.score}`;
        if (this.gameOver) {
            text += " GAME OVER.";
        }
        this._headerText = text;
    }

    lose() {
        this.gameOver = true;
        this.updateHeaderText();
        this.draw();
        writeln("Game over. Press Space to play again.");
    }

    runOneFrame() {
        const oldHead = this.snake[this.snake.length - 1];
        this.direction = this.commandedDirection;
        const newHead = this.add(oldHead, this.direction);

        if (!this.withinGameBounds(newHead)) {
            this._crashPosition = oldHead;
            this.lose();
            return;
        }
        
        if (this.equals(newHead, this.food)) {
            this.score += 10;
            this.updateHeaderText();
            this.food = this.findFreeCell();
        } else {
            this.snake.shift();
        }

        if (this.snakeContains(newHead)) {
            this._crashPosition = newHead;
            this.lose();
            return;
        }

        this.snake.push(newHead);

        this.draw();
    }

    draw() {
        this._ctx.fillStyle = "lightblue";
        this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

        for (let [col, row] of this.snake) {
            this._ctx.fillStyle = "red";
            Grid.fillCell(this._ctx, this._cellSize, [col, row]);
        }
        this._ctx.fillStyle = "green";
        Grid.fillCell(this._ctx, this._cellSize, this.food);

        if (this._crashPosition != null) {
            this._ctx.fillStyle = "purple";
            Grid.fillCell(this._ctx, this._cellSize, this._crashPosition);
        }

        this._ctx.fillStyle = "black";
        for (let col = 0; col < this._numColumns; col ++) {
            Grid.characterCell(this._ctx, this._cellSize, [col, 0], this._headerText.charAt(col));
        }

        Grid.cellLines(this._ctx, this._cellSize, this._lines);
    }

    withinGameBounds(cell) {
        return (cell[0] >= 0 && cell[0] < this._numColumns && 
                cell[1] >= Snake.MARGIN_TOP && cell[1] < this._numRows);
    }

    findFreeCell() {
        // avoid hanging the browser tab, if we mess up
        for (let i = 0; i < 10_000; i++) {
            let randomCol = Math.floor(Math.random() * this._numColumns);
            let randomRow = Snake.MARGIN_TOP + Math.floor(Math.random() * (this._numRows - Snake.MARGIN_TOP));
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

    const menubarItems = [
        {
            text: "Start over",
            id: "START_OVER",
        },
    ]

    const window = await createWindow("Snake", [324, 324], {menubarItems});
    const snake = new Snake(window.canvas);

    window.addEventListener("menubarButtonWasClicked", ({buttonId}) => {
        snake.restart();
    });

    window.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Snake shutting down").finally(resolvePromise);
        } else {
            snake.handleKeydown(event);
        }
    });

    window.addEventListener("windowWasResized", (event) => {
        console.log("TODO SNAKE RESIZE: ", event);
        const shortestSide = Math.min(event.width, event.height);
        snake.resize(event.width, event.height);
        //window.canvas.width = shortestSide;
       // window.canvas.height = shortestSide;
        //snake.grid.draw(this._ctx);
    });

    snake.run();

    return programDonePromise;
}
