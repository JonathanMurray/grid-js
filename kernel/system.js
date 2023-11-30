"use strict";

class TextFile {
    constructor(text) {
        this.text = text;
    }
}

class OpenFileDescription {
    constructor(system, id, file) {
        this.system = system;
        this.id = id;
        this.file = file;
        this.numStreams = 1;
        this.charIndex = 0;
    }

    write(text) {
        const existing = this.file.text;
        this.file.text = existing.slice(0, this.charIndex) + text + existing.slice(this.charIndex + text.length);
        this.charIndex += text.length;
    }

    read() {
        const text = this.file.text.slice(this.charIndex);
        this.charIndex = this.file.text.length;
        return text;
    }

    onStreamClose() {
        this.numStreams --;
        assert(this.numStreams >= 0);

        if (this.numStreams == 0) {
            delete this.system.openFileDescriptions[this.id];
        }
    }

    onStreamDuplicate() {
        assert(this.numStreams > 0); // One must exist to be duplicated
        this.numStreams ++;
    }
}

class System {

    constructor(files) {
        this.files = files;

        this.syscalls = new Syscalls(this);

        this.nextPid = 1;
        this.processes = {};

        this.pseudoTerminals = {};
     
        this.windowManager = null;

        // https://man7.org/linux/man-pages/man2/open.2.html#NOTES
        this.nextOpenFileDescriptionId = 1;
        this.openFileDescriptions = {};
    }

    static async init() {

        /*
        system.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        */

        const programs = [
            "cat",
            "countdown",
            "crash", 
            "diagnose",
            "echo",
            "editor", 
            "inspect",
            "kill",
            "launcher", 
            "less",
            "lines",
            "ls", 
            "plot", 
            "ps", 
            "shell", 
            "snake", 
            "sudoku", 
            "terminal", 
            "test", 
            "top",
            "time", 
        ];
        let files = {
            "textfile": new TextFile("hello world\nthis is the second line. it is longer. it may even be long enough to have to break.\n and here is the third line after a white space."),
            "short": new TextFile("hello world"),
            "empty": new TextFile("<script>\nfunction main() {}\n"),
            "log": new TextFile("<script>\nasync function main(args) { console.log(args); }\n"),
            "config.json": new TextFile('{"prompt": "~ "}\n')
        };
        for (let program of programs) {
            const text = await System.fetchProgram(program);    
            files[program] = new TextFile(text);
        }

        const system = new System(files);

        function spawnFromUi(programName) {
            const streams = {1: new NullStream(), 2: new NullStream()};
            system.spawnProcess({programName, args: [], streams, ppid: null, pgid: "START_NEW", sid: null});    
        }

        system.windowManager = await WindowManager.init(spawnFromUi);

        system.spawnProcess({programName: "terminal", args: ["shell"], streams: {1: new LogOutputStream("[TERMINAL]")}, ppid: null, pgid: "START_NEW", sid: null});
        //system.spawnProcess({programName: "sudoku", args: ["crash"], streams: {1: new LogOutputStream("[MAIN]"), 0: new NullStream()}, ppid: null, pgid: "START_NEW", sid: null});

        return system;
    }

    static async fetchProgram(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        return code;
    }

    async call(syscall, args, pid) {
        if (!(syscall in this.syscalls)) {
            throw new SysError(`no such syscall: '${syscall}'`);
        }

        const proc = this.processes[pid];
        assert(proc != undefined);

        if (args == undefined) {
            // Syscall implementations that try to destructure args crash otherwise
            args = {};
        }

        proc.syscallCount += 1;
        
        return await this.syscalls[syscall](proc, args);
    }

    waitForOtherProcessToExit(pid, pidToWaitFor, nonBlocking) {
        const proc = this.process(pid);
        const procToWaitFor = this.process(pidToWaitFor);

        if (nonBlocking) {
            if (procToWaitFor.exitValue != null) {
                return procToWaitFor.exitValue;
            } else {
                throw {name: "SysError", message: "process is still running", errno: Errno.WOULDBLOCK};
            }
        }

        console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
        const self = this;
        return proc.waitForOtherToExit(procToWaitFor).then((exitValue) => {
            //console.log(`${pid} successfully waited for ${pidToWaitFor} to exit. Exit value: ${JSON.stringify(exitValue)}`, exitValue);
            delete self.processes[pidToWaitFor];
            //console.log("After deletion; processes: ", self.processes);

            if (exitValue instanceof Error) {
                throw exitValue;
            }

            return exitValue;
        });
    }
    
    handleMessageFromWorker(pid, message) {
        if ("syscall" in message.data) {
            // Sandboxed programs send us syscalls from iframe
            this.handleSyscallMessage(pid, message);
        } else if ("crashed" in message.data) {
            this.handleProcessCrashed(pid, message.data.crashed)
        } else if ("resizeDone" in message.data) {
            this.windowManager.onResizeDone(pid);
        } else {
            console.error("Unhandled message from worker: ", message);
        }
    }

    handleProcessCrashed(pid, error) {
        const proc = this.processes[pid];
        assert(proc != undefined);

        const stdout = proc.streams[1];
        if (stdout != undefined) {

            const programName = proc.programName;

            function writeErrorLine(text) {
                function writer(error)  {
                    console.assert(error == undefined, "Failed writing crash message", text);
                    return text + "\n";
                }
                stdout.requestWrite(writer);
            }

            writeErrorLine(`${ANSI_CSI}37;41m[${pid}] Process crashed!${ANSI_CSI}39;49m`);

            if (error.stack) {
                const stackLines = error.stack.split('\n');
    
                let hasStartedWritingStackLines = false;

                let deepestStackPosition = null;
    
                const regex = /\((.+):(.+):(.+)\)/;
                for (let stackLine of stackLines) {
                    //console.log("STACK LINE: ", stackLine);
                    const match = stackLine.match(regex);
                    if (match) {
                        const fileName = match[1];
                        //console.log(`FILENAME: '${fileName}'`)
                        if (fileName.startsWith("eval at") && fileName.endsWith("<anonymous>")) {
                            const headerLen = 1; // Runnable file starts with a header that is stripped off before we execute it

                            const lineNumber = parseInt(match[2]) + headerLen;
                            const colNumber = parseInt(match[3]);
                            
                            if (deepestStackPosition == null) {
                                deepestStackPosition = [lineNumber, colNumber];
                            }
                            const translatedStackLine = stackLine.replace(regex, `(${programName}:${lineNumber}:${colNumber})`);
                            //console.log(`TRANSLATED LINE: '${translatedStackLine}'`);
                            writeErrorLine(translatedStackLine);
                            hasStartedWritingStackLines = true;
                        }
                    } else if (!hasStartedWritingStackLines) {
                        writeErrorLine(stackLine);
                    }
                }

                if (deepestStackPosition != null) {
                    let [lineNumber, colNumber] = deepestStackPosition;

                    const code = this.files[programName].text;
                    let line = code.split("\n")[lineNumber - 1];

                    if (line !== undefined) {
                        // Remove uninteresting whitespace on the left
                        let trimmedLine = line.trim();
                        colNumber -= (line.length - trimmedLine.length);
                        line = trimmedLine;
    
                        const width = 35;
                        let i = 0; 
                        for (; i < line.length - width; i++) {
                            if (i + width/4 >= colNumber) {
                                // the point of interest is now at a good place, horizontally
                                break;
                            }
                        }
                        colNumber -= i;
    
                        if (line.length - i > width) {
                            line = line.slice(i, i + width) + " ...";
                        } else {
                            line = line.slice(i, i + width);
                        }
    
                        if (i > 0) {
                            line = "... " + line;
                            colNumber += 4;
                        }
    
                        const lineNumString = lineNumber.toString();
                        
                        writeErrorLine(`\n${lineNumString} | ${line}`);
                        writeErrorLine(" ".padEnd(lineNumString.length + 3 + colNumber) + 
                                        `${ANSI_CSI}31m^${ANSI_CSI}39m`);
                    }
                }
            }

        }

        this.onProcessExit(proc, error);
    }

    handleSyscallMessage(pid, message) {
        const {syscall, arg, sequenceNum} = message.data.syscall;

        console.debug(pid, `${syscall}(${JSON.stringify(arg)}) ...`);
        this.call(syscall, arg, pid).then((result) => {
            if (pid in this.processes) {
                console.debug(pid, `... ${syscall}() --> ${JSON.stringify(result)}`);
                let transfer = [];
                if (result instanceof OffscreenCanvas) {
                    // Ownership of the canvas needs to be transferred to the worker
                    // https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
                    transfer.push(result);
                }
                this.processes[pid].worker.postMessage({syscallResult: {success: result, sequenceNum}}, transfer);
            }
        }).catch((error) => {
            if (pid in this.processes) {
                if (error instanceof SysError || error.name == "ProcessInterrupted" || error.name == "SysError") {
                    console.debug(pid, `... ${syscall}() --> `, error);
                } else {
                    console.error(pid, `... ${syscall}() --> `, error);
                }
                this.processes[pid].worker.postMessage({syscallResult: {error, sequenceNum}});
            }
        });
    }

    spawnProcess({programName, args, streams, ppid, pgid, sid}) {
        assert(args != undefined);
        if (programName in this.files) {
            const lines = this.files[programName].text.split("\n");
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid ++;
                if (pgid == "START_NEW") {
                    pgid = pid;  // The new process becomes leader of a new process group
                }
                if (sid == null) {
                    sid = pid;  // The new process becomes leader of a new session
                }

                const worker = new Worker("kernel/process-worker.js", {name: `[${pid}] ${programName}` });
                const proc = new Process(worker, code, programName, args, pid, streams, ppid, pgid, sid);
                this.processes[pid] = proc;

                console.log(`[${pid}] NEW PROCESS. parent=${ppid}, group=${pgid}, session=${sid}`)

                
                worker.postMessage({startProcess: {programName, code, args, pid}});
                worker.onmessage = (msg) => this.handleMessageFromWorker(pid, msg);

                return pid;
            }
            throw new SysError("file is not runnable: " + programName);
        }
        throw new SysError("no such program file: " + programName);
    }

    createWindow(title, size, proc, resizable, menubarItems) {
        return this.windowManager.createWindow(title, size, proc, resizable, menubarItems);
    }

    onProcessExit(proc, exitValue) {
        const pid = proc.pid;
        assert(pid != undefined);
        console.log(`[${pid}] PROCESS EXIT`, exitValue)
        if (proc.exitValue == null) {
            proc.onExit(exitValue);
            this.windowManager.removeWindowIfExists(pid);
            
            if (proc.pid == proc.sid && proc.sid in this.pseudoTerminals) {
                console.log(`[${proc.pid}] Session leader controlling PTTY dies. Sending HUP to foreground process group.`)
                const pty = this.pseudoTerminals[proc.sid];
                this.sendSignalToProcessGroup("hangup", pty.foreground_pgid);
                delete this.pseudoTerminals[proc.sid];
            }
    
            //console.log("Pseudo terminal sids: ", Object.keys(this.pseudoTerminals));
        }
    }

    listProcesses() {
        let procs = [];
        for (let pid of Object.keys(this.processes)) {
            const proc = this.process(pid);
            let streams = {};
            for (const [streamId, stream] of Object.entries(proc.streams)) {
                streams[streamId] = stream.type;
            }
            procs.push({
                pid, 
                sid: proc.sid, 
                ppid: proc.ppid, 
                programName: proc.programName, 
                pgid: proc.pgid, 
                exitValue: proc.exitValue, 
                syscallCount: proc.syscallCount,
                streams,
            });
        }
        return procs;
    }

    procOpenFile(proc, fileName, createIfNecessary) {
        let file = this.files[fileName];
        if (file == undefined) {
            if (createIfNecessary) {
                file = new TextFile("");
                this.files[fileName] = file;
            } else {
                throw new SysError("no such file");
            }
        }

        const id = this.nextOpenFileDescriptionId ++;
        const openFileDescription = new OpenFileDescription(this, id, file);
        this.openFileDescriptions[id] = openFileDescription;
        const fileStream = new FileStream(openFileDescription);

        const streamId = proc.addStream(fileStream);
        return streamId;
    }

    procSetFileLength(proc, streamId, length) {
        const file = proc.streams[streamId].openFileDescription.file;
        file.text = file.text.slice(0, length);
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
        if (!(pid in this.processes)) {
            throw new SysError("no such process: " + pid);
        }
        return this.processes[pid];
    }

    createPseudoTerminal(proc) {
        if (proc.pid != proc.sid) {
            throw new SysError("only session leader can create a pseudoterminal")
        }
        if (proc.pid != proc.pgid) {
            throw new SysError("only process group leader can create a pseudoterminal")
        }

        const pty = new PseudoTerminal(this, proc.sid);
        this.pseudoTerminals[proc.sid] = pty;

        const masterIn = proc.addStream(new PipeReader(pty.pipeToMaster));
        const masterOut = proc.addStream(pty.masterWriter);
        const slaveIn = proc.addStream(new PipeReader(pty.pipeToSlave));
        const slaveOut = proc.addStream(pty.slaveWriter);

        return {master: {in: masterIn, out: masterOut}, slave: {in: slaveIn, out: slaveOut}};
    }

    configurePseudoTerminal(proc, config) {
        const pty = this.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal connected to session");
        }
        pty.configure(config);
    }

    getTerminalSize(proc) {
        const pty = this.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal connected to session");
        }
        return pty.terminalSize();
    }
}

const SignalBehaviour = {
    EXIT: "EXIT",
    IGNORE: "IGNORE",
    HANDLE: "HANDLE"
};



class SysError extends Error {
    constructor(message, errno) {
        super(message);
        this.name = "SysError";
        this.errno = errno;
    }
}
