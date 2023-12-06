"use strict";

async function main(args) {

    const window = await stdlib.createWindow("Launcher", [450, 250], {resizable: false});

    const {
        GuiManager,
        Direction,
        AlignChildren,
        SelectionList,
        TextContainer,
        TextInput,
        Button,
        Container,
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
                .addChild(new Button(ctx, "Launch", {onClick: maybeLaunch}))
                .addChild(new Button(ctx, "Cancel", {onClick: cancel}))
        );

    async function cancel() {
        await syscall("exit");
    }

    async function maybeLaunch() {
        if (picked != null) {
            await syscall("spawn", {program: picked, pgid: "START_NEW"});
            await syscall("exit");
        }
    }

    const guiManager = new GuiManager(window, ctx, root);

    window.onkeydown = async function(event) {
        const key = event.key;
        if (key == "Enter") {
            await maybeLaunch();
            guiManager.redraw();
        } 
    };

    return new Promise((r) => {});
}
