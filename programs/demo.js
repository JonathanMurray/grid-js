"use strict";

async function main(args) {

    const W = 600;
    const H = 400;

    const window = await stdlib.createWindow("Demo", [W, H], {resizable: true});

    const {
        attachUiToWindow,
        redraw,
        getElementById,
        Direction,
        AlignChildren,
        SelectionList,
        TextContainer,
        TextInput,
        Button,
        Container,

    } = gui;

    
    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");

    let clickCount = 0;

    const root = new Container({bg: "#AAA", maxSize: [W, H], direction: Direction.HORIZONTAL, padding: [5, 5], stretch: true})
        .addChild(
            new Container({bg: "#666", maxSize: [W/2, H], stretch: true, padding: 5})
                .addChild(
                    new Container({bg: "#999", padding: [10, 10], stretch: true, direction: Direction.VERTICAL})
                        .addChild(
                            new Container({align: AlignChildren.CENTER, direction: Direction.HORIZONTAL, stretch: [true, false]})
                                .addChild(new TextContainer(ctx, "Static content"))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 100], stretch: true, padding: 10, verticalScroll: true})
                                .addChild(new TextContainer(ctx, "first line"))
                                .addChild(new TextContainer(ctx, "second line"))
                                .addChild(new TextContainer(ctx, "third line"))
                                .addChild(new TextContainer(ctx, "fourth line"))
                                .addChild(new TextContainer(ctx, "fifth line"))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 100], stretch: true, padding: 10, direction: Direction.HORIZONTAL})
                                .addChild(new Container({bg: "#AAC", minSize: [100, 100]}))
                                .addChild(new Container({bg: "#CAA",  minSize: [100, 100]}))
                                .addChild(new Container({bg: "#ACA", minSize: [100, 100]}))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 100], stretch: true})
                                .addChild(new TextContainer(ctx, "This text is declared as one long line, but it should be automatically wrapped in the UI.", {id: "longtext"}))
                        )
                )
        )
        .addChild(
            new Container({bg: "#666", maxSize: [W/2 - 15, H], stretch: true, padding: 5})
                .addChild(
                    new Container({bg: "#999", padding: [10, 10], stretch: true, direction: Direction.VERTICAL})
                        .addChild(
                            new Container({bg: "#999", align: AlignChildren.CENTER, stretch: [true, false], direction: Direction.HORIZONTAL})
                                .addChild(new Button(ctx, "Click me", {onClick: () => {
                                    clickCount ++;
                                    getElementById("CLICK_COUNT").setText(`Clicked ${clickCount} times`);
                                }}))
                        )
                        .addChild(
                            new TextContainer(ctx, "...", {id: "CLICK_COUNT", color: "#11F"})
                        )
                        .addChild(
                            new SelectionList(
                                70,
                                (idx) => getElementById("SELECTION").setText(`Selected index: ${idx}`)
                            )
                                .addItem(new TextContainer(ctx, "Select"))
                                .addItem(new TextContainer(ctx, "one"))
                                .addItem(new TextContainer(ctx, "of"))
                                .addItem(new TextContainer(ctx, "these"))
                                .addItem(new TextContainer(ctx, "items")),
                        )
                        .addChild(new TextContainer(ctx, "...", {id: "SELECTION",  color: "#11F"}))
                        .addChild(new TextContainer(ctx, "Type something and it will appear below:"))
                        .addChild(new TextInput(ctx, "", {maxTextLength: 20}))
                )
        );

    attachUiToWindow(root, window);

    window.addEventListener("windowWasResized", (event) => {
        console.log(event);
        canvas.width = event.width;
        canvas.height = event.height;

        root._maxSize = [event.width, event.height];
        redraw();
    });

    return new Promise((r) => {});
}
