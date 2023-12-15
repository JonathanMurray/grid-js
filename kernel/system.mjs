"use strict";


import {TextFile, BrowserConsoleFile, NullFile, PipeFile, FileOpenMode, OpenFileDescription, FileDescriptor, PseudoTerminal} from "./io.mjs";
import { WindowManager } from "./window-manager.mjs";
import { Process } from "./process.mjs";
import { Syscalls } from "./syscalls.mjs";
import { SysError, WaitError } from "./errors.mjs";
import { Errno } from "./errors.mjs";
import { ANSI_CSI, assert } from "../shared.mjs";

async function fetchProgram(programName) {
    if (!programName.endsWith(".mjs")) {
        programName += ".js";
    }
    const response = await fetch("programs/" + programName, {});
    let code = await response.text();
    code = "<script>\n" + code;
    return code;
}

export class System {

    static async init() {

        const programs = [
            "cat",
            "countdown",
            "crash",
            "diagnose",
            "demo",
            "echo",
            "editor", 
            "debug",
            "fibonacci",
            "filepicker2",
            "inspect",
            "js",
            "json",
            "kill",
            "launcher2",
            "less",
            "lines",
            "ls", 
            "plot", 
            "ps", 
            "shell", 
            "snake", 
            "sudoku", 
            "taskman",
            "terminal", 
            "test", 
            "top",
            "time", 
        ];
        let files = {};
        for (let program of programs) {
            const text = await fetchProgram(program);    
            program = program.replace(/(\.js)|(\.mjs)$/, "");
            files[program] = new TextFile(program, text);
        }

        const customFiles = [
            new TextFile("textfile", "hello world\nthis is the second line. it is longer. it may even be long enough to have to break.\n and here is the third line after a white space."),
            new TextFile("short", "hello world"),
            new TextFile("empty", "<script>\nfunction main() {}\n"),
            new TextFile("log", "<script>\nasync function main(args) { console.log(args); }\n"),
            new TextFile("config.json", '{"prompt": "~ "}\n'),
            new BrowserConsoleFile("con"),
            new NullFile("null"),
            new PipeFile("p"),
        ];
        
        for (const f of customFiles) {
            files[f.getFileName()] = f;
        }
        
        const system = new System(files);
        
        const nullStream = system._addOpenFileDescription(files["null"], FileOpenMode.READ_WRITE);
        
        async function spawnFromUi(programName) {
            
            const fds = {0: nullStream.duplicate(), 1: nullStream.duplicate()};
            await system._spawnProcess({programName, args: [], fds, ppid: null, pgid: "START_NEW", sid: null});    
        }
        
        system._windowManager = await WindowManager.init(spawnFromUi);
        
        const consoleStream = system._addOpenFileDescription(files["con"], FileOpenMode.READ_WRITE);
        await system._spawnProcess({programName: "terminal", args: ["shell"], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null});
        
        //await system._spawnProcess({programName: "demo", args: [], fds: {1: consoleStream}, ppid: null, pgid: "START_NEW", sid: null});
        
        return system;
    }

    constructor(files) {
        this._fileSystem = files;
        this._syscalls = new Syscalls(this);
        this._nextPid = 1;
        this._processes = {};
        this._pseudoTerminals = {};
        this._windowManager = null;

        // https://man7.org/linux/man-pages/man2/open.2.html#NOTES
        this._nextOpenFileDescriptionId = 1;
        this.openFileDescriptions = {};

        this._nextUnnamedPipeId = 1;
    }

    writeInputFromBrowser(text) {
        this._fileSystem["con"].addInputFromBrowser(text);
    }

    async call(syscall, args, pid) {
        if (!(syscall in this._syscalls)) {
            throw new SysError(`no such syscall: '${syscall}'`);
        }

        const proc = this._processes[pid];
        assert(proc != undefined);

        if (args == undefined) {
            // Syscall implementations that try to destructure args crash otherwise
            args = {};
        }

        proc.onSyscallStart();
        const result = await this._syscalls[syscall](proc, args);
        proc.onSyscallEnd();
        return result;
    }

    waitForOtherProcessToExit(pid, pidToWaitFor, nonBlocking) {
        const proc = this.process(pid);
        const procToWaitFor = this.process(pidToWaitFor);

        function throwIfError(exitValue) {
            if (exitValue instanceof Error) {
                // The error we have here is the wrapped error created in sys.mjs, i.e. it's of type Error
                // and not easily parseable. So we'll wrap it once again to make it parseable.
                throw new WaitError(exitValue);
            }
            return exitValue;
        }

        if (nonBlocking) {
            if (procToWaitFor.exitValue != null) {
                return throwIfError(procToWaitFor.exitValue);
            } else {
                throw {name: "SysError", message: "process is still running", errno: Errno.WOULDBLOCK};
            }
        }

        //console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
        const self = this;
        return proc.waitForOtherToExit(procToWaitFor).then((exitValue) => {
            console.log(`${pid} successfully waited for ${pidToWaitFor} to exit. Exit value: ${JSON.stringify(exitValue)}`, exitValue);
            delete self._processes[pidToWaitFor];
            //console.log("After deletion; processes: ", self.processes);
            return throwIfError(exitValue);
        });
    }
    
    handleMessageFromWorker(pid, message) {
        if ("syscall" in message.data) {
            // Sandboxed programs send us syscalls from iframe
            this.handleSyscallMessage(pid, message);
        } else {
            console.error("Unhandled message from worker: ", message);
        }
    }

    handleSyscallMessage(pid, message) {
        const {syscall, arg, sequenceNum} = message.data.syscall;

        console.debug(pid, `${syscall}(${JSON.stringify(arg)}) ...`);
        this.call(syscall, arg, pid).then((result) => {
            if (pid in this._processes) {
                console.debug(pid, `... ${syscall}() --> ${JSON.stringify(result)}`);
                let transfer = [];
                if (result != null && typeof result == "object" && "canvas" in result && result.canvas instanceof OffscreenCanvas) {
                    // Ownership of the canvas needs to be transferred to the worker
                    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
                    transfer.push(result.canvas);
                }
                this._processes[pid].worker.postMessage({syscallResult: {success: result, sequenceNum}}, transfer);
            }
        }).catch((error) => {
            if (pid in this._processes) {
                if (error instanceof SysError || error.name == "ProcessInterrupted" || error.name == "SysError" || error.name == "WaitError") {
                    console.debug(pid, `... ${syscall}() --> `, error);
                } else {
                    console.error(pid, `... ${syscall}() --> `, error);
                }
                this._processes[pid].worker.postMessage({syscallResult: {error, sequenceNum}});
            }
        });
    }

    async _spawnProcess({programName, args, fds, ppid, pgid, sid}) {
        assert(args != undefined);
        const file = this._fileSystem[programName];

        if (file === undefined) {
            throw new SysError("no such program file: " + programName);
        }

        if (!(file instanceof TextFile)) {
            throw new SysError("file is not runnable: " + programName);
        }

        const lines = file.text.split("\n");

        if (lines[0] !== "<script>") {
            throw new SysError("file is not runnable: " + programName);
        }

        const code = lines.slice(1).join("\n");
        const pid = this._nextPid ++;
        if (pgid == "START_NEW") {
            pgid = pid;  // The new process becomes leader of a new process group
        }
        if (sid == null) {
            sid = pid;  // The new process becomes leader of a new session
        }

        const worker = new Worker("kernel/process-worker.mjs", {name: `[${pid}] ${programName}`, type: "module"});
        const proc = new Process(worker, code, programName, args, pid, fds, ppid, pgid, sid);
        this._processes[pid] = proc;

        console.log(`[${pid}] NEW PROCESS (${programName}). parent=${ppid}, group=${pgid}, session=${sid}`);

        // Since the worker initializes asynchronously (due to using modules), we await an init message from it
        // (at which point we know that it's listening for messages) before we send anything to it.
        let setWorkerInitialized;
        const isWorkerInitialized = new Promise((r) => setWorkerInitialized = r);
        worker.onmessage = (msg) => {
            assert(msg.data.initDone);
            setWorkerInitialized();
        };
        await isWorkerInitialized;

        worker.onmessage = (msg) => this.handleMessageFromWorker(pid, msg);
        worker.postMessage({startProcess: {programName, code, args, pid}});

        return pid;
    }

    async procSetupGraphics(proc, title, size, resizable, menubarItems) {
        const {socketFile, canvas} = await this._windowManager.setupGraphics(proc, title, size, resizable, menubarItems);
        const fileDescriptor = this._addOpenFileDescription(socketFile, FileOpenMode.READ_WRITE);
        const socketFd = proc.addFileDescriptor(fileDescriptor);
        return {socketFd, canvas};
    }

    onProcessExit(proc, exitValue) {
        const pid = proc.pid;
        assert(pid != undefined);
        //console.log(`[${pid}] PROCESS EXIT`, exitValue, `prev exit value: ${proc.exitValue}, fds=`, proc.fds);
        if (proc.exitValue == null) {
            proc.onExit(exitValue);

            this._windowManager.removeWindowIfExists(pid);
            
            // TODO Handle this inside PTY close() instead?
            if (proc.pid == proc.sid && proc.sid in this._pseudoTerminals) {
                console.log(`[${proc.pid}] Session leader controlling PTTY dies. Sending HUP to foreground process group.`)
                const pty = this._pseudoTerminals[proc.sid];
                this.sendSignalToProcessGroup("hangup", pty.foreground_pgid);
                delete this._pseudoTerminals[proc.sid];
            }
    
            //console.log("Pseudo terminal sids: ", Object.keys(this.pseudoTerminals));
        }
    }

    listProcesses() {
        let procs = [];
        for (let pid of Object.keys(this._processes)) {
            const proc = this.process(pid);
            let fds = {};
            for (const [fd, value] of Object.entries(proc.fds)) {
                fds[fd] = {type: value.getFileType(), name: value.getFileName()};
            }
            procs.push({
                pid, 
                sid: proc.sid, 
                ppid: proc.ppid, 
                programName: proc.programName, 
                pgid: proc.pgid, 
                exitValue: proc.exitValue, 
                syscallCount: proc.syscallCount,
                fds,
                ongoingSyscall: proc.getOngoingSyscall(),
                userlandActivity: proc.calculateUserlandActivity()
            });
        }
        return procs;
    }

    procOpenFile(proc, fileName, createIfNecessary) {
        let file = this._fileSystem[fileName];
        if (file == undefined) {
            if (createIfNecessary) {
                file = new TextFile(fileName, "");
                this._fileSystem[fileName] = file;
            } else {
                throw new SysError("no such file");
            }
        }

        const fileDescriptor = this._addOpenFileDescription(file, FileOpenMode.READ_WRITE);
        const fd = proc.addFileDescriptor(fileDescriptor);
        return fd;
    }

    _addOpenFileDescription(file, mode) {
        assert(file != null);
        const id = this._nextOpenFileDescriptionId ++;
        const openFileDescription = new OpenFileDescription(this, id, file, mode);
        this.openFileDescriptions[id] = openFileDescription;
        return new FileDescriptor(openFileDescription);
    }

    procCreateUnnamedPipe(proc) {
        const id = this._nextUnnamedPipeId ++;
        const pipeFile = new PipeFile(`[pipe:${id}]`);
        const reader = this._addOpenFileDescription(pipeFile, FileOpenMode.READ);
        const writer = this._addOpenFileDescription(pipeFile, FileOpenMode.WRITE);
        const readerId = proc.addFileDescriptor(reader);
        const writerId = proc.addFileDescriptor(writer);
        return {readerId, writerId};
    }

    getFileStatus(fileName) {
        const file = this._fileSystem[fileName];
        if (file === undefined) {
            throw new SysError("no such file");
        }
        return file.getStatus();
    }

    listFiles() {
        return Object.keys(this._fileSystem);
    }

    procSpawn(proc, programName, args, fds, pgid) {

        let fileDescriptors = {};
        try {
            if (fds != undefined) {
                for (let i = 0; i < fds.length; i++) {
                    const parentFd = parseInt(fds[i]);
                    const fileDescriptor = proc.fds[parentFd].duplicate();
                    assert(fileDescriptor != undefined);
                    fileDescriptors[i] = fileDescriptor;
                }
            } else {
                // Inherit the parent's fds
                for (let i in proc.fds) {
                    fileDescriptors[i] = proc.fds[i].duplicate();
                }
            }
    
            if (pgid != "START_NEW") {
                if (pgid != undefined) {
                    // TODO: Should only be allowed if that group belongs to the same session as this process
                    // Join a specific existing process group
                    pgid = parseInt(pgid);
                } else {
                    // Join the parent's process group
                    pgid = proc.pgid;
                }
            }
    
            // Join the parent's session
            const sid = proc.sid;
            
            return this._spawnProcess({programName, args, fds: fileDescriptors, ppid: proc.pid, pgid, sid});
        } catch (e) {

            // Normally, a process closes its file descriptors upon exit, but here we failed to spawn the process.
            for (let fd in fileDescriptors) {
                fileDescriptors[fd].close();
            }

            throw e;
        }
    }

    procSendSignalToProcess(proc, signal, pid) {
        if (pid == proc.pid) {
            // TODO: shouldn't be able to kill ancestors either?
            throw new SysError("process cannot kill itself");
        }
        const receiverProc = this.process(pid);
        if (receiverProc != undefined) {
            this.sendSignalToProcess(signal, receiverProc);
        } else {
            throw new SysError("no such process");
        }
    }

    sendSignalToProcessGroup(signal, pgid) {
        let foundSome = false;
        // Note: likely quite bad performance below
        for (let pid of Object.keys(this._processes)) {
            const proc = this._processes[pid];
            if (proc.pgid == pgid) {
                this.sendSignalToProcess(signal, proc);
                foundSome = true;
            }
        }
        if (!foundSome) {
            console.log(`Couldn't send signal ${signal} to non-existent process group ${pgid}`);
        }
    }

    sendSignalToProcess(signal, proc) {
        console.log(`[${proc.pid}] Received signal: ${signal}`);
        let lethal;
        if (signal == "kill") {
            lethal = true;
        } else if (signal == "interrupt") {
            lethal = proc.receiveInterruptSignal();
        } else if (signal == "hangup") {
            lethal = true;
        } else if (signal == "terminalResize") {
            proc.receiveTerminalResizeSignal();
            lethal = false;
        } else {
            throw new SysError(`no such signal: '${signal}'`);
        }

        if (lethal) {
            this.onProcessExit(proc, {killedBy: signal});
        }
    }

    process(pid) {
        if (!(pid in this._processes)) {
            throw new SysError("no such process: " + pid);
        }
        return this._processes[pid];
    }

    createPseudoTerminal(proc) {
        if (proc.pid != proc.sid) {
            throw new SysError("only session leader can create a pseudoterminal")
        }
        if (proc.pid != proc.pgid) {
            throw new SysError("only process group leader can create a pseudoterminal")
        }

        const pty = new PseudoTerminal(this, proc.sid);
        this._pseudoTerminals[proc.sid] = pty; // TODO

        const master = this._addOpenFileDescription(pty.master, FileOpenMode.READ_WRITE);
        const slave = this._addOpenFileDescription(pty.slave, FileOpenMode.READ_WRITE);

        const masterId = proc.addFileDescriptor(master);
        const slaveId = proc.addFileDescriptor(slave);

        return {master: masterId, slave: slaveId};
    }
    
    procOpenPseudoTerminalSlave(proc) {
        const pty = this._pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal connected to session");
        }
        const slave = this._addOpenFileDescription(pty.openNewSlave(), FileOpenMode.READ_WRITE);
        const slaveId = proc.addFileDescriptor(slave);
        return slaveId;
    }

    controlPseudoTerminal(proc, config) {
        const pty = this._pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal connected to session");
        }
        return pty.control(config);
    }
}

// To enable debugging in the browser console
window["sys"] = await System.init();

