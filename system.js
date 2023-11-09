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
            "countdown", "cat", "test", "snake", "animation", "editor", "sudoku", "plot", 
            "ls", "time", "launcher", "shell", "terminal"
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

        const pid = system.spawnProcess({programName: "terminal", args: [], streams: {}, ppid: null, pgid: null, sid: null});

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
                if (pgid == null) {
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
        const programWindows = Array.from(document.getElementsByClassName("program-window"));
        const frontMostWindow = programWindows.reduce(function(prev, current) {
            return (prev && prev.style.zIndex > current.style.zIndex) ? prev : current
        })
        this.focusProgramWindow(frontMostWindow);
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
}


class Syscalls {
    constructor(system) {
        this.system = system;
    }

    joinNewSessionAndProcessGroup(arg, pid) {
        const proc = this.system.processes[pid];
        // Note that this has no effect if the process is already session leader and process group leader.
        proc.sid = proc.pid;
        proc.pgid = proc.pid;
    }

    createPseudoTerminal(arg, pid) {
        const proc = this.system.processes[pid];
        if (proc.pid != proc.sid) {
            throw new SyscallError("only session leader can create a pseudoterminal")
        }
        if (proc.pid != proc.pgid) {
            throw new SyscallError("only process group leader can create a pseudoterminal")
        }
        const pty = new PseudoTerminal(proc);
        this.system.pseudoTerminals[proc.sid] = pty;

        const masterReaderId = proc.addStream(new PipeReader(pty.slaveToMaster));
        const masterWriterId = proc.addStream(new PipeWriter(pty.masterToSlave));
        const slaveReaderId = proc.addStream(new PipeReader(pty.masterToSlave));
        const slaveWriterId = proc.addStream(new PipeWriter(pty.slaveToMaster));

        return {masterReaderId, masterWriterId, slaveReaderId, slaveWriterId};
    }

    setForegroundProcessGroupOfPseudoTerminal({pgid, toSelf}, pid) {
        if ((pgid == undefined && toSelf == undefined) || (pgid != undefined && toSelf != undefined)) {
            throw new SyscallError(`exactly one of pgid and toSelf should be set. pgid=${pgid}, toSelf=${toSelf}`);
        }
        const proc = this.system.processes[pid];
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SyscallError("no pseudoterminal is controlled by this process' session")
        }
        if (toSelf) {
            pgid = proc.pgid;
        }
        pty.setForegroundPgid(pgid);
    }

    getForegroundProcessGroupOfPseudoTerminal(arg, pid) {
        const proc = this.system.processes[pid];
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SyscallError("no pseudoterminal is controlled by this process' session")
        }
        return pty.foreground_pgid;
    }

    createPipe(arg, pid) {
        const proc = this.system.processes[pid];

        const pipe = new Pipe();

        const readerId = proc.addStream(new PipeReader(pipe));
        const writerId = proc.addStream(new PipeWriter(pipe));

        return {readerId, writerId};
    }

    listProcesses(arg, pid) {
        let procs = [];
        for (let pid of Object.keys(this.system.processes)) {
            const proc = this.system.processes[pid];
            procs.push({pid, ppid: proc.ppid, programName: proc.programName, pgid: proc.pgid});
        }
        return procs;
    }

    exit(arg, pid) {
        console.assert(pid != undefined);
        return this.system.onProcessExit(pid);
    }

    sendSignal({signal, pid, pgid}, senderPid) {

        if ((pid == undefined && pgid == undefined) || (pid != undefined && pgid != undefined)) {
            throw new SyscallError(`exactly one of pid and pgid should be set. pid=${pid}, pgid=${pgid}`);
        }

        if (pid != undefined) {
            if (pid == senderPid) {
                // TODO: shouldn't be able to kill ancestors either?
                throw new SyscallError("process cannot kill itself");
            }
            const proc = this.system.processes[pid];
            if (proc != undefined) {
                this.system.sendSignalToProcess(signal, proc);
            } else {
                throw new SyscallError("no such process");
            }
        } else if (pgid != undefined) {
            this.system.sendSignalToProcessGroup(signal, pgid);
        }
    }

    ignoreInterruptSignal(arg, pid) {
        const proc = this.system.processes[pid];
        proc.interruptSignalBehaviour = InterruptSignalBehaviour.IGNORE;
    }

    handleInterruptSignal(arg, pid) {
        const proc = this.system.processes[pid];
        proc.interruptSignalBehaviour = InterruptSignalBehaviour.HANDLE;
    }

    write({line, streamId}, pid) {
        if (line == undefined) {
            throw new SyscallError("missing line argument");
        }
        const proc = this.system.processes[pid];
        return proc.write(streamId, line);
    }

    read({streamId}, pid) {
        if (streamId == undefined) {
            throw new SyscallError("missing streamId argument");
        }
        const proc = this.system.processes[pid];
        return proc.read(streamId);
    }

    readAny({streamIds}, pid) {
        const proc = this.system.processes[pid];
        return proc.readAny(streamIds);
    }

    listFiles(arg, pid) {
        return Object.keys(this.system.files);
    }

    saveToFile({lines, fileName}, pid) {
        console.assert(fileName, "Must provide filename when saving to file");
        return this.system.saveLinesToFile(lines, fileName);
    }

    readFromFile(fileName, pid) {
        return this.system.readLinesFromFile(fileName);
    }

    async spawn({program, args, nullStreams, streamIds, startNewProcessGroup}, ppid) {

        const parentProc = this.system.processes[ppid];

        let streams;
        if (streamIds != undefined) {
            streams = {};
            for (let i = 0; i < streamIds.length; i++) {
                const parentStreamId = parseInt(streamIds[i]);
                const stream = parentProc.streams[parentStreamId];
                console.assert(stream != undefined);
                streams[i] = stream;
            }
        } else if (nullStreams) {
            const nullStream = new NullStream();
            streams = {0: nullStream, 1: nullStream}
        } else {
            // Inherit the parent's streams
            streams = Object.assign({}, parentProc.streams);
        }

        let pgid;
        if (startNewProcessGroup) {
            pgid = null;
        } else {
            // Join the parent's process group
            pgid = parentProc.pgid;
        }

        // Join the parent's session
        const sid = parentProc.sid;
        
        const childPid = await this.system.spawnProcess({programName:program, args, streams, ppid, pgid, sid});

        return childPid;
    }

    waitForExit(pidToWaitFor, pid) {
        const proc = this.system.processes[pidToWaitFor];
        if (proc) {
            console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
            return proc.waitForExit();
        }
        console.debug("Process doesn't exist / has already exited");
    }

    graphics({title, size}, pid) {
        const programWindow = document.getElementById("program-window-" + pid);
        programWindow.style.display = "block";

        const iframe = programWindow.getElementsByTagName("iframe")[0];
        if (size != undefined) {
            iframe.width = size[0];
            iframe.height = size[1];
        }
        title = `[${pid}] ${title || "Untitled"}`
        programWindow.getElementsByClassName("program-window-header")[0].innerHTML = title;

        this.system.focusProgramWindow(programWindow);

        const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
        programWindow.style.left = availableScreenSpace.width / 2 - programWindow.getBoundingClientRect().width / 2;
        programWindow.style.top = availableScreenSpace.height / 2 - programWindow.getBoundingClientRect().height / 2;

        console.debug("showed iframe", iframe);
    }
}

const InterruptSignalBehaviour = {
    EXIT: "EXIT",
    IGNORE: "IGNORE",
    HANDLE: "HANDLE"
};

class Process {

    constructor(code, programName, args, system, pid, streams, ppid, pgid, sid) {
        console.assert(streams != undefined);
        if (args == undefined) {
            args = [];
        }
        this.code = code;
        this.pid = pid; // Process ID
        this.ppid = ppid; // Parent process ID
        this.pgid = pgid // Process group ID
        this.sid = sid; // Session ID
        this.programName = programName;
        this.args = args;
        this.exitWaiters = [];
        this.system = system;
        this.streams = streams; // For reading and writing. By convention 0=stdin, 1=stdout
        
        this.nextStreamId = 0;
        for (let streamId of Object.keys(streams)) {
            streamId = parseInt(streamId);
            this.nextStreamId = Math.max(this.nextStreamId, streamId + 1);
        }
        console.assert(this.nextStreamId != NaN);

        this.hasExited = false;
        this.interruptSignalBehaviour = InterruptSignalBehaviour.EXIT;

        this.ongoingSyscalls = {};

        this.nextPromiseId = 1;
        this.promiseCallbacks = {};
    }

    receiveInterruptSignal() {
        if (this.interruptSignalBehaviour == InterruptSignalBehaviour.EXIT) {
            this.system.onProcessExit(this.pid);
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.HANDLE) {
            console.log(`[${this.pid}] Handling interrupt signal. Ongoing syscall promises=${JSON.stringify(this.promiseCallbacks)}`)
            // Any ongoing syscalls will throw an error that can be
            // caught in the application code.
            for (let id of Object.keys(this.promiseCallbacks)) {
                this.promiseCallbacks[id].reject({name: "ProcessInterrupted", message: "interrupted"});
                delete this.promiseCallbacks[id];
            }
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.IGNORE) {
            //console.debug(`[${this.pid}] ignoring interrupt signal`)
        }
    }

    promise() {
        let resolver;
        let rejector;
        const promise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejector = reject;
        });
        const promiseId = this.nextPromiseId ++;
        this.promiseCallbacks[promiseId] = {resolve: resolver, reject: rejector};
        return {promise, promiseId};
    }

    resolvePromise(id, result) {
        this.promiseCallbacks[id].resolve(result);
        delete this.promiseCallbacks[id];
    }
    
    write(streamId, line) {
        const outputStream = this.streams[streamId];
        console.assert(outputStream != undefined);
        const {promise, promiseId} = this.promise();
        const self = this;
        outputStream.requestWrite(() => {
            if (self.hasExited) {
                return null; // signal that we are no longer attempting to write
            }
            this.resolvePromise(promiseId);
            return line; // give the line to the stream
        });

        return promise;
    }

    read(streamId) {
        const inputStream = this.streams[streamId];
        console.assert(inputStream != undefined, `No stream found with ID ${streamId}. Streams: ${Object.keys(this.streams)}`)
        const {promise, promiseId} = this.promise();
        const reader = (line) => {
            this.resolvePromise(promiseId, line);
            return true; // signal that we read the line
        }
        inputStream.requestRead({reader, proc: this});
        return promise;
    }

    readAny(streamIds) {
        const {promise, promiseId} = this.promise();
        let hasResolvedPromise = false;

        const self = this;
        for (let streamId of streamIds) {
            const inputStream = this.streams[streamId];
            console.assert(inputStream != undefined, `No stream found with ID ${streamId}. Streams: ${Object.keys(this.streams)}`)

            const reader = (line) => {
                if (hasResolvedPromise) {
                    return false; // signal that we ended up not reading the line
                }
    
                this.resolvePromise(promiseId, {line, streamId});
                hasResolvedPromise = true;
                return true; // signal that we read the line
            };

            inputStream.requestRead({reader, proc: this});
        }

        return promise;
    }

    addStream(stream) {
        const streamId = this.nextStreamId ++;
        this.streams[streamId] = stream;
        return streamId;
    }

    start() {
        const iframe = document.createElement("iframe");
        this.iframe = iframe;
        iframe.sandbox = "allow-scripts";

        iframe.onload = () => {
            iframe.contentWindow.postMessage({startProcess: {code: this.code, args: this.args, pid: this.pid}}, "*");
        }

        iframe.src = "sandboxed-program.html";

        const header = document.createElement("div");
        header.classList.add("program-window-header");
        header.style = "background:lightgray; font-family: system-ui; font-weight: bold;";
        header.innerHTML = "Program sandbox";
        
        const programWindow = document.createElement("div");
        this.programWindow = programWindow;
        programWindow.style = "display: none; position: absolute; background: white; user-select: none;";
        programWindow.id = "program-window-" + this.pid;
        programWindow.classList.add("program-window");

        programWindow.appendChild(header);
        programWindow.appendChild(iframe);

        programWindow.addEventListener("mousedown", (event) => {
            const left = parseInt(programWindow.style.left.replace("px", "")) || programWindow.getBoundingClientRect().x;
            const top = parseInt(programWindow.style.top.replace("px", "")) || programWindow.getBoundingClientRect().y;
            this.system.draggingWindow = {element: programWindow, offset: [event.x - left, event.y - top], iframe};
            this.system.focusProgramWindow(programWindow);
        });

        iframe.addEventListener("mousedown", (event) => {
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("focus", (event) => {
            programWindow.classList.add("focused");
        });
        header.addEventListener("focus", (event) => {
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("blur", (event) => {
            programWindow.classList.remove("focused");
        });

        document.getElementsByTagName("body")[0].appendChild(programWindow);
    }

    onExit() {
        this.programWindow.remove();
        for (let waiter of this.exitWaiters) {
            waiter();
        }
        this.hasExited = true;
    }

    waitForExit() {
        let waiter;
        // TODO handle properly so that it can be interrupted
        const exitPromise = new Promise((resolve) => waiter = resolve);
        this.exitWaiters.push(waiter);
        return exitPromise;
    }

}

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
        this.handleWaitingReaders();
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


class NullStream {
    requestRead() {
        // The reader will never get input
    }

    requestWrite() {
        // The output is discarded
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
