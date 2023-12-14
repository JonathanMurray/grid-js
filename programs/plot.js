"use strict";

import { writeln, createWindow } from "/lib/stdlib.mjs";

class Plot {

    constructor(canvas, func) {
        this.canvas = canvas;
        
        const ctx = canvas.getContext("2d");
        //const scale = window.devicePixelRatio;
        //ctx.scale(scale, scale);

        this.origin = [canvas.width / 2, canvas.height / 2];

        ctx.strokeStyle = "gray";
        ctx.beginPath();
        ctx.moveTo(0, this.origin[1]);
        ctx.lineTo(canvas.width, this.origin[1]);
        ctx.moveTo(this.origin[0], 0);
        ctx.lineTo(this.origin[0], canvas.height);
        ctx.stroke();

        let f;

        if (func == undefined) {
            f = x => Math.sin(x) - Math.tan(x);
            writeln("Plotting sin - tan");
        } else if (func == "sin") {
            f = x => Math.sin(x);
            writeln("Plotting sin");
        } else if (func == "cos") {
            f = x => Math.cos(x);
            writeln("Plotting cos");
        } else if (func == "tan") {
            f = x => Math.tan(x);
            writeln("Plotting tan");
        } else {
            f = x => x;
            writeln("Unrecognized function. Plotting linear");
        }

        const xRange = 10;

        this.xScale = this.origin[0] / xRange;
        this.yScale = 100;

        let x = -xRange;
        let y = f(x);
        const coords = this.coordinates(x, y);
        ctx.strokeStyle = "#005500";
        ctx.beginPath();
        ctx.moveTo(coords[0], coords[1]);
        for (; x < xRange; x += 0.01) {
            y = f(x);
            const coords = this.coordinates(x, y);
            ctx.lineTo(coords[0], coords[1]);
        }
        ctx.stroke();
    }

    coordinates(x, y) {
        return [this.origin[0] + x * this.xScale, this.origin[1] - y * this.yScale];
    }
}

async function main(args) {

    let resolvePromise;
    let programDonePromise = new Promise((r) => {resolvePromise = r;});

    let title = "Plot";

    let func;
    if (args.length > 0) {
        func = args[0];
        title += ": " + func;
    }

    const {canvas} = await createWindow(title, [300, 300]);
    
    const app = new Plot(canvas, func);

    return programDonePromise;
}
