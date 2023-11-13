"use strict";


class System {

    constructor() {
        this.syscalls = new Syscalls(this);

        this.nextPid = 1;
        this.processes = {};

        this.pseudoTerminals = {};
        
        this.maxZIndex = 1;

        this.files = {};

        this.draggingWindow = null;
    }

    static async init() {

        const system = new System();

        /*
        system.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        */

        const programs = [
            "animation", 
            "cat",
            "countdown",
            "crash", 
            "echo",
            "editor", 
            "launcher", 
            "ls", 
            "plot", 
            "ps", 
            "shell", 
            "snake", 
            "sudoku", 
            "terminal", 
            "test", 
            "time", 
        ];
        let files = {
            "textfile": ["first line", "", "third line"],
            "empty": ["<script>", "function main() {}"],
            "log": ["<script>", "async function main(args) { console.log(args); }"],
        };
        for (let program of programs) {
            const lines = await System.fetchProgram(program);    
            files[program] = lines;
        }
        system.files = files;

        const pid = system.spawnProcess({programName: "terminal", args: [], streams: {}, ppid: null, pgid: "START_NEW", sid: null});

        return system;
    }


    static async fetchProgram(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        return code.split("\n");
    }

    async call(syscall, arg, pid, sequenceNum) {
        if (!(syscall in this.syscalls)) {
            throw new SyscallError("no such syscall");
        }
        
        const proc = this.processes[pid];
        
        const promise = this.syscalls[syscall](arg, pid);

        proc.ongoingSyscalls[sequenceNum] = promise;
        
        const result = await promise;
        delete proc.ongoingSyscalls[sequenceNum];
        return result;
    }


    focusProgramWindow(programWindow) {

        if (programWindow.style.zIndex < this.maxZIndex) {
            programWindow.style.zIndex = ++this.maxZIndex;
        }

        programWindow.getElementsByTagName("iframe")[0].focus();
        programWindow.classList.add("focused");
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            console.log("system.keydown");
        } else if (name == "mousemove") {
            if (this.draggingWindow != null) {
                const {element, iframe, offset} = this.draggingWindow;
                element.style.left = event.x - offset[0];
                element.style.top = event.y - offset[1];
                this.focusProgramWindow(element);
            }
        } else if (name == "mouseup") {
            if (this.draggingWindow != null) {
                const {element, iframe, offset} = this.draggingWindow;
                this.focusProgramWindow(element);
                this.draggingWindow = null;
            }
        } else if (name == "message") {
            if ("syscall" in event.data) {
                // Sandboxed programs send us syscalls from iframe
                this.handleSyscallMessage(event);
            } else {
                console.assert("iframeReceivedFocus" in event.data);
                const pid = event.data.iframeReceivedFocus.pid;
                const programWindow = document.getElementById("program-window-" + pid);
                this.focusProgramWindow(programWindow);
            }
        } else {
            console.warn("Unhandled system event", name, event);
        }
    }

    handleSyscallMessage(event) {
        const {syscall, arg, pid, sequenceNum} = event.data.syscall;

        console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) ...`);

        this.call(syscall, arg, pid, sequenceNum).then((result) => {
            console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> ${JSON.stringify(result)}`);
            const programWindow = document.getElementById("program-window-" + pid);
            if (programWindow) {
                const iframe = programWindow.getElementsByTagName("iframe")[0];
                iframe.contentWindow.postMessage({syscallResult: {success: result, sequenceNum}}, "*");
                console.debug("Sent syscall result to program iframe");
            } else {
                console.debug("Cannot send syscall to process. It has no window. It must have shut down itself already.");
            }
        }).catch((error) => {
            if (error instanceof SyscallError || error.name == "ProcessInterrupted") {
                console.warn(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
                const programWindow = document.getElementById("program-window-" + pid);
                if (programWindow) {
                    const iframe = programWindow.getElementsByTagName("iframe")[0];
                    iframe.contentWindow.postMessage({syscallResult: {error, sequenceNum}}, "*");
                    console.debug("Sent syscall error to program iframe");
                } else {
                    console.debug("Cannot send syscall error to process. It has no window. It must have shut down itself already.");
                }
            } else {
                console.error(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
            }
        });
    }

    printOutput(output) {
        this.terminal.printOutput(output);
    }

    spawnProcess({programName, args, streams, ppid, pgid, sid}) {
        if (programName in this.files) {
            const lines = this.files[programName];
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid ++;
                if (pgid == "START_NEW") {
                    pgid = pid;  // The new process becomes leader of a new process group
                }
                if (sid == null) {
                    sid = pid;  // The new process becomes leader of a new session
                }

                const proc = new Process(code, programName, args, this, pid, streams, ppid, pgid, sid);
                this.processes[pid] = proc;

                console.log(`[${pid}] NEW PROCESS. parent=${ppid}, group=${pgid}, session=${sid}`)

                proc.start(); // We make sure that the pid is in the process table before the program starts running

                return pid;
            }
            throw new SyscallError("file is not runnable: " + programName);
        }
        throw new SyscallError("no such program file: " + programName);
    }

    onProcessExit(pid) {
        console.assert(pid != undefined);
        console.log(`[${pid}] PROCESS EXIT`)
        let proc = this.processes[pid];
        delete this.processes[pid];
        proc.onExit();

        if (proc.pid == proc.sid && proc.sid in this.pseudoTerminals) {
            console.log(`[${proc.pid}] Session leader controlling PTTY dies. Sending HUP to foreground process group.`)
            const pty = this.pseudoTerminals[proc.sid];
            this.sendSignalToProcessGroup("hangup", pty.foreground_pgid);
            delete this.pseudoTerminals[proc.sid];
        }

        console.log("Pseudo terminal sids: ", Object.keys(this.pseudoTerminals));

        this.focusFrontMostWindow();
    }

    focusFrontMostWindow() {
        const theWindow = this.frontMostWindow();
        this.focusProgramWindow(theWindow);
    }

    frontMostWindow() {
        const programWindows = Array.from(document.getElementsByClassName("program-window"));
        return programWindows.reduce(function(prev, current) {
            return (prev && prev.style.zIndex > current.style.zIndex) ? prev : current
        });
    }

    saveLinesToFile(lines, fileName) {
        this.files[fileName] = lines;
    }

    readLinesFromFile(fileName) {
        if (fileName in this.files) {
            return this.files[fileName];
        }
        return null; 
    }

    
    sendSignalToProcessGroup(signal, pgid) {
        let foundSome = false;
        // Note: likely quite bad performance below
        for (let pid of Object.keys(this.processes)) {
            const proc = this.processes[pid];
            if (proc.pgid == pgid) {
                this.sendSignalToProcess(signal, proc);
                foundSome = true;
            }
        }
        if (!foundSome) {
            throw new SyscallError("no such process group");
        }
    }

    sendSignalToProcess(signal, proc) {
        console.log(`[${proc.pid}] Received signal: ${signal}`);
        if (signal == "kill") {
            this.onProcessExit(proc.pid);
        } else if (signal == "interrupt") {
            proc.receiveInterruptSignal();
        } else if (signal == "hangup") {
            this.onProcessExit(proc.pid);
        } else {
            throw new SyscallError("no such signal");
        }
    }

    process(pid) {
        if (!(pid in this.processes)) {
            throw new SyscallError("no such process: " + pid);
        }
        return this.processes[pid];
    }
}

const InterruptSignalBehaviour = {
    EXIT: "EXIT",
    IGNORE: "IGNORE",
    HANDLE: "HANDLE"
};


class PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor(foreground_pgid) {
        this.foreground_pgid = foreground_pgid;
        this.masterToSlave = new Pipe();
        this.slaveToMaster = new Pipe();
    }

    setForegroundPgid(pgid) {
        this.foreground_pgid = pgid;
        this.masterToSlave.setRestrictReadsToProcessGroup(pgid);
    }
}

class Pipe {
    constructor() {
        this.buffer = [];
        this.waitingReaders = [];
        this.restrictReadsToProcessGroup = null;
    }

    setRestrictReadsToProcessGroup(pgid) {
        this.restrictReadsToProcessGroup = pgid;
        while (this.handleWaitingReaders()) {}
    }
    
    isProcAllowedToRead(proc) {
        return this.restrictReadsToProcessGroup == null || this.restrictReadsToProcessGroup == proc.pgid;
    }

    requestRead({reader, proc}) {
        this.waitingReaders.push({reader, proc});
        this.handleWaitingReaders();
    }

    handleWaitingReaders() {
        if (this.buffer.length > 0) {
            if (this.waitingReaders.length > 0) {
                for (let i = 0; i < this.waitingReaders.length;) {
                    const {reader, proc} = this.waitingReaders[i];
                    if (proc.hasExited) {
                        // The process will never be able to read
                        this.waitingReaders.splice(i, 1);
                    } else if (this.isProcAllowedToRead(proc)) {
                        this.waitingReaders.splice(i, 1);
                        const line = this.buffer[0];
                        // Check that a read actually occurs. This is necessary because of readAny()
                        if (reader(line)) {
                            this.buffer.shift();
                            return true; 
                        }
                    } else {
                        // The reader was left in the list, and we move onto the next one
                        i++;
                    }
                }
            }
        }
        return false;
    }

    requestWrite(writer) {
        const line = writer();
        this.buffer.push(line);
        this.handleWaitingReaders();
    }
}

class PipeReader {
    constructor(pipe) {
        this.pipe = pipe;
    }

    requestRead(arg) {
        return this.pipe.requestRead(arg);
    }
}

class PipeWriter {
    constructor(pipe) {
        this.pipe = pipe;
    }
    
    requestWrite(writer) {
        return this.pipe.requestWrite(writer);
    }
}

class SyscallError extends Error {
    constructor(message) {
        super(message);
        this.name = "SyscallError";
    }
}
