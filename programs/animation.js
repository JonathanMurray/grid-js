"use strict";

class Animation {

    static FRAME_DURATION = 10;

    constructor(canvas) {
        const grid = new Grid(canvas, {numColumns:16, numRows:16, xOffset:1, yOffset:1});
        this.grid = grid;
        this.canvas = canvas;
        grid.showBackgroundLines = false;

        this.previousTimestamp;
        this.timeUntilNextFrame = Animation.FRAME_DURATION;

        this.col = 0;
        this.row = 0;
        this.color = [0, 0, 0];

        this.done = false;

        const self = this;
        window.requestAnimationFrame(timestamp => self.step(timestamp));
    }

    step(timestamp) {
        if (this.previousTimestamp != undefined) {
            const elapsed = timestamp - this.previousTimestamp;
            this.timeUntilNextFrame -= elapsed;
            while (this.timeUntilNextFrame <= 0 && !this.done) {
                this.runOneFrame();
                this.timeUntilNextFrame += Animation.FRAME_DURATION;
            }
        }
        this.previousTimestamp = timestamp;

        if (!this.done) {
            window.requestAnimationFrame(timestamp => this.step(timestamp)); 
        }
    }

    runOneFrame() {
        console.assert(this.row < this.grid.numRows);
        this.grid.backgrounds[this.col][this.row] = `#${this.color[0]}${this.color[1]}${this.color[2]}`;
        this.grid.draw();
        this.col ++;
        if (this.col == this.grid.numColumns) {
            this.row ++;
            this.col = 0;
        }
        this.color[0] = (this.color[0] + 1) % 10;
        this.color[1] = (this.color[1] + 3) % 10;
        this.color[2] = (this.color[2] + 7) % 10;

        if (this.row == this.grid.numRows) {
            this.done = true;
        }
    }
}

async function main(args) {

    let resolvePromise;
    let programDonePromise = new Promise((r) => {resolvePromise = r;});

    const canvas = await stdlib.createWindow("Animation", [300, 300]);
    
    const app = new Animation(canvas);

    window.addEventListener("keydown", function(event) {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Animation shutting down").finally(resolvePromise);
        }
    });

    return programDonePromise;
}

