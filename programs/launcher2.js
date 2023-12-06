"use strict";

async function main(args) {

    const window = await stdlib.createWindow("Launcher", [450, 250], {resizable: false});

    const {
        Direction,
        AlignChildren,
        SelectionList,
        TextContainer,
        TextInput,
        Button,
        Container,
        getEvents
    } = gui;

    
    const descriptions = {
        "terminal": "Explore the system with a shell.",
        "snake": "Eat the fruit and don't collide!",
        "sudoku": "Solve the puzzle!",
        "editor": "Edit text files.",
    };
    const fileNames = Object.keys(descriptions);

    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");
    
    let picked = null;

    ctx.font = "18px monospace";

    const root = new Container({maxSize: [canvas.width, canvas.height], bg: "#444", direction: Direction.VERTICAL, padding: [10, 5], stretch: true});

    const selectionList = new SelectionList(
        new Container({direction: Direction.VERTICAL, stretch: true, bg: "#555", maxSize: [999, 195], verticalScroll: true}),
        (itemIdx) => {
            picked = fileNames[itemIdx];
            titleElement.setText(picked);
            descriptionElement.setText(descriptions[picked]);
        }
    );
  
    for (const fileName of fileNames) {
        selectionList.addItem(new Container({padding: [5, 0]}).addChild(new TextContainer(ctx, fileName)));
    }

    const titleElement = new TextContainer(ctx, "", {color: "magenta", font: "bold 20px monospace"});
    const descriptionElement = new TextContainer(ctx, "", {color: "#FFF"});

    root
    .addChild(new TextContainer(ctx, "Select a program:", {font: "bold 20px monospace"}))
    .addChild(new Container({padding: [0, 5]}))
    .addChild(selectionList)
    .addChild(new Container({padding: [0, 5]}))
    .addChild(new Container().addChild(titleElement))
    .addChild(new Container().addChild(descriptionElement))
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10, stretch: true, align: AlignChildren.END})
                .addChild(new Button(ctx, "Launch", {onClick: "LAUNCH"}))
                .addChild(new Button(ctx, "Cancel", {onClick: "CANCEL"}))
        );

    async function maybeLaunch() {
        if (picked != null) {
            await syscall("spawn", {program: picked, pgid: "START_NEW"});
            await syscall("exit");
        }
    }

    await ui({pos: [0, 0]});

    async function ui(mouse) {
        ctx.fillStyle = "lightgray";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.resetTransform();
        root.draw(ctx, [canvas.width, canvas.height], mouse);

        let redraw = false;
        for (const event of getEvents()) {
            if (event == "LAUNCH") {
                await maybeLaunch();
            } else {
                await syscall("exit");
            }
        }

        if (redraw) {
            ui();
        }
    }

    let mousePos = null;

    window.onmousemove = (event) => {
        mousePos = [event.x, event.y];
        ui({pos: mousePos});
    }
    window.onmousedown = (event) => {
        ui({pos: mousePos, changedToDown: true});
    }
    window.onkeydown = async function(event) {
        const key = event.key;
        if (key == "Enter") {
            await maybeLaunch();
        } 
    };

    return new Promise((r) => {});
}
