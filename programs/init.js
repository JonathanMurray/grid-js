import { syscall } from "/lib/sys.mjs";

async function main(args) {
    console.log("[init] starting...");

    await syscall("spawn", {programPath: "/bin/terminal", args: ["/bin/shell"], pgid: "START_NEW"});

    //await system._spawnProcess({programPath: "/bin/terminal", args: ["/bin/shell"], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null, workingDirectory: "/"});
    //await system._spawnProcess({programPath: "/bin/editor", args: [], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null, workingDirectory: "/"});

    while (true) {
        // TODO handle child crash
        const {pid, exitValue} = await syscall("waitForExit", {pid: "ANY_CHILD"});
        console.log(`[init] child [${pid}] exited: ${exitValue}`, exitValue);
    }
}
