"use strict";

async function main(args) {

    let fileNames = await syscall("listFiles");

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

    const window = await stdlib.createWindow("GUI test", [600, 320], {resizable: false});

    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");

    ctx.font = "18px monospace";

    const inputElement = new TextInput(ctx, "_", {minSize: [445, 0], bg: "#555", borderColor: "#FFF"});
    let input = "";
    const errorElement = new TextContainer(ctx, "", {color: "#F99"});

    const root = new Container({maxSize: [canvas.width, canvas.height], bg: "#444", direction: Direction.VERTICAL, padding: 5, stretch: true});

    const selectionList = new SelectionList(
        new Container({direction: Direction.VERTICAL, stretch: true, bg: "#555", maxSize: [999, 195], verticalScroll: true}),
        (itemIdx) => {
            input = fileNames[itemIdx];
            updateInputElement();
        }
    );
    root.addChild(selectionList);

    for (const fileName of fileNames) {
        selectionList.addItem(new TextContainer(ctx, fileName));
    }

    root
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10})
                .addChild(
                    new Container({padding: [8, 5]})
                        .addChild(new TextContainer(ctx, "File name:"))
                )
                .addChild(inputElement)
        )
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10, stretch: true, align: AlignChildren.END})
                .addChild(new Container({padding: [20, 5]}).addChild(errorElement))
                .addChild(new Button(ctx, "Open", {onClick: tryOpen}))
                .addChild(new Button(ctx, "Cancel", {onClick: onClickCancel}))
        );

    async function onClickCancel() {
        await syscall("exit");
    }

    async function tryOpen() {
        if (fileNames.includes(input)) {
            await syscall("exit", {picked: input});
        }
        errorElement.setText("No such file!");
    }

    function updateInputElement() {
        inputElement.setText(input + "_");
        
        errorElement.setText("");
    }

    const guiManager = new GuiManager(window, ctx, root);

    window.addEventListener("keydown", async function(event) {
        const key = event.key;
        errorElement.setText("");
        if (key == "Backspace") {
            if (event.ctrlKey) {
                input = "";
            } else {
                input = input.slice(0, input.length - 1);
            }
        } else if (key == "Enter") {
            await tryOpen();
        } else if (key.length == 1) {
            input += key;
        }
        
        updateInputElement();
        guiManager.redraw();
    });

    return new Promise((r) => {});
}

