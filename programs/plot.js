"use strict";

class Plot {

    constructor(canvas, syscalls, func) {
        this.canvas = canvas;
        this.syscalls = syscalls;
        
        const ctx = canvas.getContext("2d");

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
            syscalls.write(["Plotting sin - tan"]);
        } else if (func == "sin") {
            f = x => Math.sin(x);
            syscalls.write(["Plotting sin"]);
        } else if (func == "cos") {
            f = x => Math.cos(x);
            syscalls.write(["Plotting cos"]);
        } else if (func == "tan") {
            f = x => Math.tan(x);
            syscalls.write(["Plotting tan"]);
        } else {
            f = x => x;
            syscalls.write(["Unrecognized function. Plotting linear"]);
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
            console.debug(x, y);
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

    const size = [300, 300];

    await syscalls.graphics({title, size: [size[0] + 30, size[1] + 20]});

    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.style.outline = "1px solid black";
    document.getElementsByTagName("body")[0].appendChild(canvas);
    
    const app = new Plot(canvas, syscalls, func);

    window.addEventListener("keydown", function(event) {
        if (event.ctrlKey && event.key == "c") { 
            syscalls.write(["Plotter shutting down"]).finally(resolvePromise);
        }
    });

    return programDonePromise;
}
