"use strict";


class System {

    constructor() {
        this.syscalls = new Syscalls(this);

        this.nextPid = 1;
        this.processes = {};
        
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

        const pid = system.spawnProcess({programName: "terminal", args: ["terminal"], streams: {}, ppid: null, pgid: null});

        return system;
    }


    static async fetchProgram(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        return code.split("\n");
    }

    async call(syscall, arg, pid) {
        console.assert(syscall in this.syscalls, "Syscall does not exist: " + syscall);
        return await this.syscalls[syscall](arg, pid);
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
        const {syscall, arg, pid, messageId} = event.data.syscall;

        console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) ...`);

        this.call(syscall, arg, pid).then((result) => {
            console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> ${JSON.stringify(result)}`);
            const programWindow = document.getElementById("program-window-" + pid);
            if (programWindow) {
                const iframe = programWindow.getElementsByTagName("iframe")[0];
                iframe.contentWindow.postMessage({syscallResult: {success: result, messageId}}, "*");
                console.debug("Sent syscall result to program iframe");
            } else {
                console.debug("Cannot send syscall to process. It has no window. It must have shut down itself already.");
            }
        }).catch((error) => {
            if (error instanceof SyscallError) {
                console.warn(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
                const programWindow = document.getElementById("program-window-" + pid);
                if (programWindow) {
                    const iframe = programWindow.getElementsByTagName("iframe")[0];
                    iframe.contentWindow.postMessage({syscallResult: {error, messageId}}, "*");
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

    spawnProcess({programName, args, streams, ppid, pgid}) {
        if (programName in this.files) {
            const lines = this.files[programName];
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid ++;
                if (pgid == null) {
                    pgid = pid;  // The new process becomes leader of a new process group
                }

                const proc = new Process(code, args, this, pid, streams, ppid, pgid);
                this.processes[pid] = proc;

                console.log(`[${pid}] Process starting. parent=${ppid}, group=${pgid}`)

                proc.start(); // We make sure that the pid is in the process table before the program starts running

                return pid;
            }
            throw new SyscallError("file is not runnable: " + programName);
        }
        throw new SyscallError("no such program file: " + programName);
    }

    onProcessExit(pid) {
        console.assert(pid != undefined);
        console.log("Removing process", pid);
        let proc = this.processes[pid];
        delete this.processes[pid];
        proc.onExit();

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

    createPipe(pid) {
        const proc = this.processes[pid];
        return proc.createPipe();
    }

    sendSignalToProcess(signal, proc) {
        console.debug(`[${proc.pid}] Received signal: ${signal}`);
        if (signal == "kill") {
            this.onProcessExit(proc.pid);
        } else if (signal == "interrupt") {
            if (!proc.ignoresInterruptSignal) {
                this.onProcessExit(proc.pid);
            } else {
                console.debug(`[${proc.pid}] Ignored interrupt`);
            }
        } else {
            throw new SyscallError("no such signal");
        }
    }
}


class Process {

    constructor(code, args, system, pid, streams, ppid, pgid) {
        console.assert(args != undefined);
        console.assert(streams != undefined);
        this.code = code;
        this.pid = pid; // Process ID
        this.ppid = ppid; // Parent process ID
        this.pgid = pgid // Process group ID
        this.args = args;
        this.exitWaiters = [];
        this.system = system;

        this.streams = streams;
        this.nextStreamId = 2;

        this.hasExited = false;
        this.ignoresInterruptSignal = false;
    }

    write(streamId, output) {
        const outputStream = this.streams[streamId];
        console.assert(outputStream != undefined);
        for (let line of output) {
            outputStream.pushInputLine(line);
        }
    }

    read(streamId) {
        const inputStream = this.streams[streamId];

        let resolvePromise;
        let promise = new Promise((r) => resolvePromise = r);
        const self = this;
        inputStream.waitForLine((line) => {
            if (self.hasExited) {
                return false; // signal that some other process should get the line
            }

            resolvePromise(line);
            return true; // signal that we consumed the line
        });

        return promise;
    }
    
    readAny(streamIds) {
        let resolvePromise;
        let hasResolvedPromise = false;
        let promise = new Promise((r) => resolvePromise = (result) => {r(result); hasResolvedPromise = true;});
        const self = this;
        for (let streamId of streamIds) {
            const inputStream = this.streams[streamId];
            inputStream.waitForLine((line) => {
                if (self.hasExited || hasResolvedPromise) {
                    return false; // signal that some other process should get the line
                }
    
                resolvePromise({line, streamId});
                return true; // signal that we consumed the line
            });
        }

        return promise;
    }

    createPipe() {
        const pipe = new Pipe();
        const readerId = this.nextStreamId ++;
        this.streams[readerId] = new PipeReader(pipe);
        const writerId = this.nextStreamId ++;
        this.streams[writerId] = new PipeWriter(pipe);
        return {readerId, writerId};
    }

    start() {
        const iframe = document.createElement("iframe");
        this.iframe = iframe;
        iframe.sandbox = "allow-scripts";

        iframe.onload = () => {
            iframe.contentWindow.postMessage({startProcess: {code: this.code, args: this.args.slice(1), pid: this.pid}}, "*");
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
            console.log("iframe mouse down: ", programWindow.id);
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("focus", (event) => {
            console.log("iframe Focused: ", programWindow.id);
            programWindow.classList.add("focused");
        });
        header.addEventListener("focus", (event) => {
            console.log("header Focused: ", programWindow.id);
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("blur", (event) => {
            console.log("iframe Blurred: ", programWindow.id, event);
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
        const exitPromise = new Promise((resolve) => waiter = resolve);
        this.exitWaiters.push(waiter);
        return exitPromise;
    }

}

class Syscalls {
    constructor(system) {
        this.system = system;
    }

    async createPipe(arg, pid) {
        return this.system.createPipe(pid);
    }

    async listProcesses(arg, pid) {
        let procs = [];
        for (let pid of Object.keys(this.system.processes)) {
            const proc = this.system.processes[pid];
            procs.push({pid, ppid: proc.ppid, programName: proc.args[0], pgid: proc.pgid});
        }
        return procs;
    }

    async controlTerminal(arg, pid) {
        // TODO this syscall should only be allowed for a process that is the current owner of the terminal
        console.log("TODO: controlTerminal");
        //return this.system.terminal.control(arg);
    }

    async exit(arg, pid) {
        console.assert(pid != undefined);
        return this.system.onProcessExit(pid);
    }

    async sendSignal({signal, pid, pgid}, senderPid) {

        if ((pid == undefined && pgid == undefined) || (pid != undefined && pgid != undefined)) {
            throw new SyscallError(`must specify exactly one of pid and pgid. pid=${pid}, pgid=${pgid}`);
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
            let foundSome = false;
            // Note: likely quite bad performance below
            for (let pid of Object.keys(this.system.processes)) {
                const proc = this.system.processes[pid];
                if (proc.pgid == pgid) {
                    this.system.sendSignalToProcess(signal, proc);
                    foundSome = true;
                }
            }
            if (!foundSome) {
                throw new SyscallError("no such process group");
            }
        }
    }

    async ignoreInterruptSignal(arg, pid) {
        const proc = this.system.processes[pid];
        if (proc != undefined) {
            proc.ignoresInterruptSignal = true;
        } else {
            throw new SyscallError("no such process");
        }
    }

    async write({output, streamId}, pid) {
        if (output == undefined) {
            throw new SyscallError("missing output argument");
        }
        const proc = this.system.processes[pid];
        return proc.write(streamId, output);
    }

    async read({streamId}, pid) {
        if (streamId == undefined) {
            throw new SyscallError("missing streamId argument");
        }
        const proc = this.system.processes[pid];
        return proc.read(streamId);
    }

    async readAny({streamIds}, pid) {
        const proc = this.system.processes[pid];
        return proc.readAny(streamIds);
    }

    async listFiles(arg, pid) {
        return Object.keys(this.system.files);
    }

    async saveToFile({lines, fileName}, pid) {
        console.assert(fileName, "Must provide filename when saving to file");
        return this.system.saveLinesToFile(lines, fileName);
    }

    async readFromFile(fileName, pid) {
        return this.system.readLinesFromFile(fileName);
    }

    async spawn({program, args, detached, streamIds, startNewProcessGroup}, ppid) {

        const parentProc = this.system.processes[ppid];

        let streams;
        if (streamIds != undefined) {
            streams = {};
            for (let i = 0; i < streamIds.length; i++) {
                const parentStreamId = streamIds[i];
                const stream = parentProc.streams[parentStreamId];
                console.assert(stream != undefined);
                streams[i] = stream;
            }
        } else {
            streams = Object.assign({}, parentProc.streams);
        }

        let pgid;
        if (startNewProcessGroup) {
            pgid = null;
        } else {
            // Join the parent's process group
            pgid = parentProc.pgid;
        }
        
        const childPid = await this.system.spawnProcess({programName:program, args:[program].concat(args), 
                streams, ppid, pgid});

        return childPid;
    }

    async waitForExit(pidToWaitFor, pid) {
        const proc = this.system.processes[pidToWaitFor];
        if (proc) {
            console.log(pid + " Waiting for process " + pidToWaitFor + " to exit...");
            return proc.waitForExit();
        }
        console.log("Process doesn't exist / has already exited");
    }

    async graphics({title, size}, pid) {
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


class Pipe {
    constructor() {
        this.bufferedInput = [];
        this.inputWaiters = [];
    }
    
    async waitForLine(consumer) {
        const line = this.bufferedInput.shift();
        if (line != undefined) {
            console.log("Pipe.waitForLine() Got input immediately:", line);
            const didConsume = consumer(line);
            if (!didConsume) {
                // This consumer ended up not consuming the input. Probably it was a readAny syscall that got a line from some
                // other stream => we must put back the line in the stream.
                this.bufferedInput.unshift(line);
            }
            return;
        }

        console.log("Pipe.waitForLine() Registering waiter for input");

        // No input exists yet. We must wait for it.
        this.inputWaiters.push(consumer);
    }

    pushInputLine(line) {
        console.log(`Pipe.pushInputLine(${line}) ...`)
        let consumer = this.inputWaiters.shift();
        while (consumer != undefined) {
            const didConsume = consumer(line);
            if (didConsume) {
                console.log("A waiter consumed the input:", line);
                return;
            } else {
                // This waiter ended up not consuming the input. Probably its corresponding process has exited since it made the
                // read syscall. Then another process needs to be given the line instead.
                consumer = this.inputWaiters.shift();
            }
        }

        console.log("No waiter. Buffering input:", line);

        // Noone is currently waiting for input. We must buffer it.
        this.bufferedInput.push(line);
    }
}

class PipeReader {
    constructor(pipe) {
        this.pipe = pipe;
    }

    waitForLine(consumer) {
        return this.pipe.waitForLine(consumer);
    }

}

class PipeWriter {
    constructor(pipe) {
        this.pipe = pipe;
    }
    
    pushInputLine(line) {
        return this.pipe.pushInputLine(line);
    }
}

class SyscallError extends Error {
    constructor(message) {
        super(message);
        this.name = "SyscallError";
    }
}