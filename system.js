"use strict";


class System {

    constructor() {

        this.terminal = null; // Should be assigned after construction
        
        this.syscalls = new Syscalls(this);
        window.syscalls = this.syscalls;

        this.nextPid = 1;
        this.processes = {};
        this.foregroundProcess = null;
        
        this.maxZIndex = 1;

        this.files = {}

        this.draggingWindow = null;

        this.stdIn = new Input();
    }

    static async init(canvas) {

        const system = new System();

        const terminal = new Terminal(canvas, system);
        system.terminal = terminal;

        const now = new Date();
        system.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        
        terminal.setFocused(true);

        const programs = [
            "countdown", "cat", "test", "snake", "animation", "editor", "sudoku", "plot", 
            "ls", "time", "launcher", "shell"
        ];

        let files = {
            "textfile": ["first line", "", "third line"],
            "empty": ["<script>", "function main() {}"],
            "log": ["<script>", "async function main(args) { console.log(args); }"],
            "print": ["<script>", "async function main(args) { await syscalls.write(args); }"],
        };

        for (let program of programs) {
            const lines = await System.fetchProgram(program);    
            files[program] = lines;
        }


        system.files = files;

        const shellPid = system.spawnProcess({programName:"shell", args:["shell"], 
            inputStream:system.stdIn, parentPid:null});
        system.setForegroundProcess(shellPid);

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

    moveToFront(element) {
        if (element.style.zIndex < this.maxZIndex) {
            this.maxZIndex ++;
            element.style.zIndex = this.maxZIndex;
        }
    }

    focusProgramWindow(programWindow) {
        this.moveToFront(programWindow);
        programWindow.getElementsByTagName("iframe")[0].focus();
    }

    handleEvent(name, event) {
        if (name == "keydown") {

            if (event.ctrlKey && event.key == "c" && this.foregroundProcess.parentPid != null) {
                console.log("EXITING")
                this.printOutput(["^C"]);
                this.onProcessExit(this.foregroundProcess.pid);
            } else {
                this.terminal.handleEvent(name, event);
            }

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
            // Sandboxed programs send us syscalls from iframe
            console.assert("syscall" in event.data);
            const pid = event.data.syscall.pid;
            const asyncSyscallResult = this.call(event.data.syscall.syscall, event.data.syscall.arg, pid);

            asyncSyscallResult.then((result) => {
                console.log("syscall result", event.data.syscall.syscall, event.data.syscall.arg, pid, result);
                const programWindow = document.getElementById("program-window-" + pid);
                if (programWindow) {
                    const iframe = programWindow.getElementsByTagName("iframe")[0];
                    iframe.contentWindow.postMessage({syscallResult: {success: result}}, "*");
                    console.debug("Sent syscall result to program iframe");
                } else {
                    console.log("Cannot send syscall to process. It has no window. It must have shut down itself already.");
                }
            }).catch((error) => {
                if (error instanceof SyscallError) {
                    console.log("syscall error", event.data.syscall.syscall, event.data.syscall.arg, pid, error);
                    const programWindow = document.getElementById("program-window-" + pid);
                    if (programWindow) {
                        const iframe = programWindow.getElementsByTagName("iframe")[0];
                        iframe.contentWindow.postMessage({syscallResult: {error}}, "*");
                        console.debug("Sent syscall error to program iframe");
                    } else {
                        console.log("Cannot send syscall error to process. It has no window. It must have shut down itself already.");
                    }
                } else {
                    console.error("Unexpected error from syscall:", error);
                }
            });
            
        } else {
            console.warn("Unhandled system event", name, event);
        }
    }

    handleInput(input) {
        this.stdIn.pushInputLine(input);
    }

    kill(pid) {
        if (pid in this.processes) {
            this.onProcessExit(pid);
        } else {
            throw new SyscallError("no such process");
        }
    }

    printOutput(output) {
        this.terminal.printOutput(output);
    }

    async readInput(pid) {
        const proc = this.processes[pid];

        if (proc.inputStream == undefined) {
            throw new SyscallError("process has no input stream");
        }

        let resolvePromise;
        let promise = new Promise((r) => resolvePromise = r);
        const self = this;
        proc.inputStream.waitForLine((line) => {
            const proc = self.processes[pid];
            if (proc == undefined) {
                console.log("The process that wanted to read the line doesn't exist anymore.");
                return false; // signal that some other process should get the line
            }

            resolvePromise(line);
            return true; // signal that we consumed the line
        });

        return promise;
    }

    spawnProcess({programName, args, inputStream, parentPid}) {
        if (programName in this.files) {
            const lines = this.files[programName];
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid;
                this.nextPid ++;

                const proc = new Process(code, args, this, pid, inputStream, parentPid);
                this.processes[pid] = proc;
                proc.start(); // We make sure that the pid is in the process table before the program starts running

                return pid;
            }
            throw Error("file is not runnable: " + programName);
        }
        throw Error("no such program file: " + programName);
    }

    setForegroundProcess(pid) {
        console.assert(pid in this.processes, "process not found: " + pid + ". processes: " + Object.keys(this.processes));
        this.foregroundProcess = this.processes[pid];
    }

    onProcessExit(pid) {
        console.assert(pid != undefined);
        console.log("Removing process", pid);
        let proc = this.processes[pid];
        delete this.processes[pid];
        proc.onExit();
        if (this.foregroundProcess == proc) {
            console.log("The removed process was in foreground.");

            const parent = this.processes[proc.parentPid];
            console.assert(parent, "killed foregrounded process must have had a parent");
            console.log("New foregrounded process: ", parent.pid);
            this.foregroundProcess = parent;

            this.terminal.setFocused(true);
            this.terminal.canvas.classList.add("focused");
            this.terminal.canvas.focus();
        }
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
}


class Process {

    constructor(code, args, system, pid, inputStream, parentPid) {
        console.assert(args != undefined);
        this.code = code;
        this.pid = pid;
        this.args = args;
        console.log("New process. input= ", inputStream);
        this.inputStream = inputStream;
        this.exitWaiters = [];
        this.system = system;
        this.parentPid = parentPid;
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
        programWindow.hidden = true;
        programWindow.style = "position: absolute; border: 2px solid lightgray; background: white; user-select: none;";
        programWindow.id = "program-window-" + this.pid;

        programWindow.appendChild(header);
        programWindow.appendChild(iframe);

        programWindow.addEventListener("mousedown", (event) => {
            const left = parseInt(programWindow.style.left.replace("px", "")) || programWindow.getBoundingClientRect().x;
            const top = parseInt(programWindow.style.top.replace("px", "")) || programWindow.getBoundingClientRect().y;
            this.system.draggingWindow = {element: programWindow, offset: [event.x - left, event.y - top], iframe};
            this.system.focusProgramWindow(programWindow);
        });

        document.getElementsByTagName("body")[0].appendChild(programWindow);

        this.system.moveToFront(programWindow);
    }

    onExit() {
        this.programWindow.remove();
        for (let waiter of this.exitWaiters) {
            waiter();
        }
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

    async listProcesses(arg, pid) {
        let procs = [];
        for (let pid of Object.keys(this.system.processes)) {
            const proc = this.system.processes[pid];
            const isInForeground = this.system.foregroundProcess == proc;
            procs.push({pid, parentPid: proc.parentPid, programName: proc.args[0], isInForeground});
        }
        return procs;
    }

    async controlTerminal(arg, pid) {
        // TODO this syscall should only be allowed for a process that is the current owner of the terminal
        return this.system.terminal.control(arg);
    }

    async exit(arg, pid) {
        console.assert(pid != undefined);
        return this.system.onProcessExit(pid);
    }

    async kill(pidToKill, pid) {
        if (pidToKill == pid) {
            throw new SyscallError("process cannot kill itself");
        }
        return this.system.kill(pidToKill);
    }

    async write(output, pid) {
        return this.system.printOutput(output);
    }

    async read(arg, pid) {
        return this.system.readInput(pid);
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

    async spawn({program, args, detached}, parentPid) {
        let inputStream;

        const parent = this.system.processes[parentPid];
        
        const wasParentForeground = this.system.foregroundProcess == parent;

        if (detached) {
            inputStream = new Input();
        } else {
            inputStream = parent.inputStream; // Inherit input stream from parent
        }
        console.log("Spawning new process, from parent " + parentPid + ". Input stream: ", inputStream, " ARGS: ", args);

        const childPid = await this.system.spawnProcess({programName:program, args:[program].concat(args), 
                inputStream, parentPid});

        if (wasParentForeground && !detached) {
            this.system.setForegroundProcess(childPid);
        }

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


class Input {
    constructor() {
        this.bufferedInput = [];
        this.inputWaiters = [];
    }
    
    async waitForLine(consumer) {
        const line = this.bufferedInput.shift();
        if (line != undefined) {
            console.log("Got input immediately:", line);
            consumer(line);
            return;
        }

        console.log("Registering waiter for input");

        // No input exists yet. We must wait for it.
        this.inputWaiters.push(consumer);
    }

    pushInputLine(line) {
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

class SyscallError extends Error {
    constructor(message) {
        super(message);
        this.name = "SyscallError";
    }
}