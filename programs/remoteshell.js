"use strict";

import { log, read, write, writeError, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { ANSI_CSI, ANSI_GET_CURSOR_POSITION, ansiCursorPosition, assert } from "/shared.mjs";

const DEFAULT_URL = "ws://localhost:8080";

async function main(args) {

    let url;
    if (args.length > 0) {
        url = args[0];
    } else {
        url = DEFAULT_URL;
    }

    await writeln(`Connecting to '${url}' ...`);

    let socket;
    try {
        socket = await connect(url);
    } catch (e) {
        writeln("No one logged in. (Start a remotelogin WebSocket server first)");
        writeError(e["message"]);
        return;
    }
    
    await writeln("Connection established.");

    const ptyMaster = await syscall("openFile", {path: "/dev/ptmx"});

    const terminalSize = await getTerminalSize(socket);
    
    await syscall("controlDevice", {fd: ptyMaster, request: {resize: terminalSize}});

    const slaveNumber = await syscall("controlDevice", {fd: ptyMaster, request: {getSlaveNumber: null}});

    socket.onmessage =  async (event) => {
        let text = event.data;
        text = text.replace("\r", "\n");
        //log(`FROM SERVER: '${text}'`, Array.from(text));
        await write(text, ptyMaster);
    };
    socket.addEventListener("error", async (error) => {
        console.error("WebSocket error: ", error);
        await writeln("\nWebSocket error: " + error);
        await syscall("exit");
    });
    socket.addEventListener("close", async (event) => {
        log("WebSocket was closed: ", event);
        await writeln("Remote user logged out.");
        await syscall("exit");
    })

    const pts = `/dev/pts/${slaveNumber}`;
    // The child needs to be in a new session, so that it can claim the PTY slave
    const shellPid = await syscall("spawn", {programPath: "/bin/shell", fds: [], pgid: "START_NEW", sid: "START_NEW", args: ["--open-tty", pts]});

    const shellPgid = shellPid; // The shell is process group leader
    await syscall("controlDevice", {fd: ptyMaster, request: {setForegroundPgid: shellPgid}});

    await writeln(`Remote user logged in.`);
    await writeln(`  shell pid: ${shellPid}`);
    await writeln(`  tty: ${pts}`);
    await writeln(`  terminal size: ${JSON.stringify(terminalSize)}`);

    let hasReceivedShellOutput = false;
    while (true) {
        const text = await read(ptyMaster);



        if (text.length > 0) {
            hasReceivedShellOutput = true;
            socket.send(text);
        } else if (hasReceivedShellOutput) {
            // Since we start reading from the PTY master before we know that the shell has opened the slave-end, we can get a bunch
            // of 0-byte reads, before we get actual output from the shell. We avoid sending those, as the remote would interpret them
            // as EOF.
            socket.send(text);
        }
    }
}

function connect(url) {
    return new Promise((resolve, reject) => {
        var server = new WebSocket(url, "tty-protocol");
        server.onopen = function() {
            resolve(server);
        };
        server.onerror = function(err) {
            reject(new Error(`couldn't connect: ${JSON.stringify(err)}`));
        };
    });
}

function getTerminalSize(socket) {
    assert(socket.onmessage == null);

    socket.send(ansiCursorPosition(999, 999));
    socket.send(ANSI_GET_CURSOR_POSITION);

    let resolveTerminalSize;
    let terminalSizePromise = new Promise(r => resolveTerminalSize = r);
    let buf = "";
    socket.onmessage = event => {
        buf += event.data;
        if (buf.endsWith("R")) {
            const [h, w] = buf.replace(ANSI_CSI, "").replace("R", "").split(";");
            let width = Number.parseInt(w);
            let height = Number.parseInt(h);
            assert(Number.isFinite(width));
            assert(Number.isFinite(height));
            socket.onmessage = () => {};
            resolveTerminalSize({width, height});
        }
    };
    
    return terminalSizePromise;
}