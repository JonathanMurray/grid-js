"use strict";

async function main(args) {

    const W = 600;
    const H = 400;

    const window = await stdlib.createWindow("Task manager", [W, H], {resizable: true});

    const {
        attachUiToWindow,
        redraw,
        getElementById,
        Direction,
        AlignChildren,
        Expand,
        SelectionList,
        TextContainer,
        TextInput,
        Button,
        Table,
        Container,
        debug,

    } = gui;

    
    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");

    let procs = [];
    let selectedPid = null;


    const procTable = new Table(
        ctx, 
        ["program", "pid"], 
        [], 
        (idx) => {
            const proc = procs[idx];
            selectedPid = proc.pid;
            updateProcessDetails(proc);
        }
    );

    function updateProcessDetails(proc) {
        selectedPid = proc.pid;
            getElementById("programName").setText(`${proc.programName} (${proc.pid})`);
            const status = proc.exitValue == null ? "running" : proc.exitValue;
            getElementById("status").setText(`status: ${status}`);
            getElementById("sid").setText(`sid: ${proc.sid}`);
            getElementById("syscalls").setText(`syscalls: ${proc.syscallCount}`);
            getElementById("fds").setText(`fds: ${JSON.stringify(proc.fds)}`);
    }

    const root = new Container({bg: "#AAA", maxSize: [W-20, H], expand: Expand.YES, direction: Direction.HORIZONTAL, padding: [20, 20]})
        .addChild(
            new Container({bg: "blue", padding: 10})
                .addChild(procTable)
        )

        .addChild(
            new Container({bg: "red", padding: 5, expand: Expand.YES})
                .addChild(
                    new Container({bg: "#999", padding: [10, 10],  expand: Expand.YES, direction: Direction.VERTICAL})
                        .addChild(
                            new TextContainer(ctx, "[name]", {id: "programName"})
                        )
                        .addChild(
                            new TextContainer(ctx, "[status]", {id: "status"})
                        )
                        .addChild(
                            new TextContainer(ctx, "[sid]", {id: "sid"})
                        )
                        .addChild(
                            new TextContainer(ctx, "[syscalls]", {id: "syscalls"})
                        )
                        .addChild(
                            new TextContainer(ctx, "[fds]", {id: "fds"})
                        )
                     
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

    window.addEventListener("keydown", (event) => {
        //debug();
    });


    while (true) {
        procs = await syscall("listProcesses");
        let programRows = [];
        for (const proc of procs) {
            programRows.push([proc.programName, proc.pid]);

            if (selectedPid == proc.pid) {
                updateProcessDetails(proc);
            }

        }
        procTable.setRows(programRows); 

        redraw();
    
        await syscall("sleep", {millis: 1000});
    }

    return new Promise((r) => {});
}
