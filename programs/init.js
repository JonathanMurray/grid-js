import { syscall } from "/lib/sys.mjs";

async function main(args) {
    console.log("STARTING UP");

    await syscall("spawn", {programPath: "/bin/terminal", args: ["/bin/shell"], pgid: "START_NEW"});

    //await system._spawnProcess({programPath: "/bin/terminal", args: ["/bin/shell"], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null, workingDirectory: "/"});
    //await system._spawnProcess({programPath: "/bin/editor", args: [], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null, workingDirectory: "/"});

    // TODO wait for children (in order to reap them)

    while (true) {
        await syscall("sleep", {millis: 60_000});
    }
}
