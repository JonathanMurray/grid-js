"use strict";

async function main(args) {

    const W = 600;
    const H = 400;

    const window = await stdlib.createWindow("Task manager", [W, H], {resizable: true});

    const gui = await import("../lib/gui.mjs");

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
            getElementById("syscall").setText(`ongoing: ${proc.ongoingSyscall}`);
            getElementById("syscalls").setText(`#syscalls: ${proc.syscallCount}`);
            const rows = Object.entries(proc.fds).map(([fd, {type, name}]) => [fd, type, name]);
            getElementById("fds").setRows(rows);
    }

    const root = new Container({expand: Expand.YES})
        .addChild(
            new Container({bg: "#AAA", expand: Expand.YES, direction: Direction.HORIZONTAL})
                .addChild(
                    new Container({expand: [Expand.NO, Expand.YES], padding: [5, 0], verticalScroll: true, })
                        .addChild(procTable)
                )

                .addChild(
                    new Container({expand: Expand.YES, verticalScroll: true, })
                        .addChild(
                            new Container({bg: "#666", padding: [10, 10],  expand: Expand.YES, direction: Direction.VERTICAL})
                                .addChild(new TextContainer(ctx, "[name]", {id: "programName", color: "#AFF"}))
                                .addChild(new TextContainer(ctx, "[status]", {id: "status"}))
                                .addChild(new TextContainer(ctx, "[sid]", {id: "sid"}))
                                .addChild(new TextContainer(ctx, "[syscall]", {id: "syscall"}))
                                .addChild(new TextContainer(ctx, "[syscalls]", {id: "syscalls"}))
                                .addChild(new TextContainer(ctx, "file descriptors:"))
                                .addChild(new Table(ctx, ["fd", "type", "file"], [], (idx)=>{}, {id: "fds"}))
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
