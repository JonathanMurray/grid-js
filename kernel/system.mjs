"use strict";


import {TextFile, PipeFile, OpenFileDescription, FileDescriptor, PseudoTerminal} from "./io.mjs";
import { WindowManager } from "./window-manager.mjs";
import { Process } from "./process.mjs";
import { Syscalls } from "./syscalls.mjs";
import { SysError, WaitError } from "./errors.mjs";
import { Errno } from "./errors.mjs";
import { FileOpenMode, FileType, assert, resolvePath } from "../shared.mjs";
import { WaitQueues } from "./wait-queues.mjs";

const INIT_PID = 1;

export class System {

    constructor(rootDir) {
        this._rootDir = rootDir;

        this._syscalls = new Syscalls(this);
        this._nextPid = INIT_PID;
        this._processes = {};
        this._pseudoTerminals = {};

        // https://man7.org/linux/man-pages/man2/open.2.html#NOTES
        this._nextOpenFileDescriptionId = 1;
        this.openFileDescriptions = {};

        this._nextUnnamedPipeId = 1;

        this._waitQueues = new WaitQueues();
    }

    async initWindowManager() {
        const nullStream = this._addOpenFileDescription(this._lookupFile(["dev", "null"]), FileOpenMode.READ_WRITE, "/dev/null", null);
        const self = this;
        async function spawnFromUi(programPath) {
            const fds = {0: nullStream.duplicate(), 1: nullStream.duplicate()};
            const parent = self._processes[INIT_PID];
            await self._spawnProcess({programPath, args: [], fds, parent, pgid: "START_NEW", sid: null, workingDirectory: "/"});    
        }

        const graphicsDevice = await WindowManager.init(spawnFromUi);
        this._lookupFile(["dev"]).createDirEntry("graphics", graphicsDevice);
    }

    writeInputFromBrowser(text) {
        this._lookupFile(["dev", "con"]).addInputFromBrowser(text);
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
        try {
            return await this._syscalls[syscall](proc, args);
        } finally {
            proc.onSyscallEnd();
        }
    }

    async procWaitForChild(proc, childPid, nonBlocking) {
        

        function throwIfError(exitValue) {
            if (exitValue instanceof Error) {
                // The error we have here is the wrapped error created in sys.mjs, i.e. it's of type Error
                // and not easily parseable. So we'll wrap it once again to make it parseable.
                throw new WaitError(exitValue);
            }
            return exitValue;
        }

        const self = this;
        if (childPid == "ANY_CHILD") {
            assert(!nonBlocking);
            let {pid, exitValue} = await proc.waitForAnyChild();
            console.log(`${proc.pid} successfully waited for any child (${pid}) to exit. Exit value: ${JSON.stringify(exitValue)}`, exitValue);
            delete self._processes[pid];
            exitValue = throwIfError(exitValue);
            return {pid, exitValue};
        } else {
            //console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
   
            const exitValue = await proc.waitForChild(childPid, nonBlocking);
            console.log(`${proc.pid} successfully waited for ${childPid} to exit. Exit value: ${JSON.stringify(exitValue)}`, exitValue);
            delete self._processes[childPid];
            return throwIfError(exitValue);
        }
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

        console.debug(pid, `[${pid}] ${syscall}(${JSON.stringify(arg)}) ...`);
        this.call(syscall, arg, pid).then((result) => {
            if (pid in this._processes) {
                console.debug(pid, `... [${pid}] ${syscall}() --> ${JSON.stringify(result)}`);
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
                    console.debug(pid, `... [${pid}] ${syscall}() --> `, error);
                } else {
                    console.error(pid, `... [${pid}] ${syscall}() --> `, error);
                }
                this._processes[pid].worker.postMessage({syscallResult: {error, sequenceNum}});
            }
        });
    }

    _lookupFile(parts) {
        assert(Array.isArray(parts));
        if (parts.length == 0) {
            return this._rootDir;
        }
        let file = this._rootDir;
        parts = [...parts]; // Don't modify the input
        while (parts.length > 0) {
            const name = parts.shift();
            file = file.dirEntries()[name];
            if (file == null && parts.length > 0) {
                throw new SysError(`no such directory: '${name}'`);
            }
        }

        return file;
    }

    async _spawnProcess({programPath, args, fds, parent, pgid, sid, workingDirectory}) {
        assert(args != undefined);

        // We assume that programPath is absolute
        const parts = resolvePath("/", programPath);
        const file = this._lookupFile(parts);

        if (file === undefined) {
            throw new SysError("no such program file: " + programPath);
        }

        if (!(file instanceof TextFile)) {
            throw new SysError("file is not runnable: " + programPath);
        }

        const lines = file.text.split("\n");

        if (lines[0] !== "<script>") {
            throw new SysError("file is not runnable: " + programPath);
        }

        const code = lines.slice(1).join("\n");
        const pid = this._nextPid ++;
        if (pgid == "START_NEW") {
            pgid = pid;  // The new process becomes leader of a new process group
        }
        if (sid == null) {
            sid = pid;  // The new process becomes leader of a new session
        }

        const ppid = parent != null ? parent.pid : null;

        const worker = new Worker("kernel/process-worker.mjs", {name: `[${pid}] ${programPath}`, type: "module"});
        const proc = new Process(worker, code, programPath, args, pid, fds, ppid, pgid, sid, workingDirectory, this._waitQueues);
        this._processes[pid] = proc;

        console.log(`[${pid}] NEW PROCESS (${programPath}). parent=${ppid}, group=${pgid}, session=${sid}`);

        // Since the worker initializes asynchronously (due to using modules), we await an init message from it
        // (at which point we know that it's listening for messages) before we send anything to it.
        let setWorkerInitialized;
        const isWorkerInitialized = new Promise((r) => setWorkerInitialized = r);
        worker.onmessage = (msg) => {
            assert(msg.data.initDone);
            setWorkerInitialized();
        };
        await isWorkerInitialized;

        if (parent != null) {
            parent.children[pid] = proc;
        }

        worker.onmessage = (msg) => this.handleMessageFromWorker(pid, msg);
        worker.postMessage({startProcess: {programName: programPath, code, args, pid}});

        return pid;
    }

    onProcessExit(proc, exitValue) {
        const pid = proc.pid;
        assert(pid != undefined);
        //console.log(`[${pid}] PROCESS EXIT`, exitValue, `prev exit value: ${proc.exitValue}, fds=`, proc.fds);
        if (proc.exitValue == null) {
            proc.onExit(exitValue);

            for (const child of Object.values(proc.children)) {
                child.ppid = INIT_PID;
                this._processes[INIT_PID].children[child.pid] = child;
            }
        }
    }

    listProcesses() {
        let procs = [];
        for (let pid of Object.keys(this._processes)) {
            const proc = this.process(pid);
            let fds = {};
            for (const [fd, fileDescriptor] of Object.entries(proc.fds)) {
                fds[fd] = {type: fileDescriptor.getStatus().type, name: fileDescriptor.getFilePath()};
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

    procOpenFile(proc, path, {createIfNecessary, mode}) {
        const parts = resolvePath(proc.workingDirectory, path);
        let file = this._lookupFile(parts);
        if (file == undefined) {
            if (createIfNecessary) {
                const directory = this._lookupFile(parts.slice(0, parts.length - 1));
                assert(directory != null);
                const fileName = parts[parts.length - 1];
                file = new TextFile("");
                directory.createDirEntry(fileName, file);
            } else {
                throw new SysError(`no such file: '${path}'`);
            }
        }

        const fileDescriptor = this._addOpenFileDescription(file, mode, path, proc);
        const fd = proc.addFileDescriptor(fileDescriptor);
        return fd;
    }

    _addOpenFileDescription(file, mode, filePath, openerProc) {
        assert(file != null);
        const id = this._nextOpenFileDescriptionId ++;
        const openFileDescription = new OpenFileDescription(this, id, file, mode, filePath, openerProc);
        this.openFileDescriptions[id] = openFileDescription;
        return new FileDescriptor(openFileDescription);
    }

    procCreateUnnamedPipe(proc) {
        const id = this._nextUnnamedPipeId ++;
        const pipeFile = new PipeFile();
        const filePath = `[pipe:${id}]`;
        const reader = this._addOpenFileDescription(pipeFile, FileOpenMode.READ, filePath, proc);
        const writer = this._addOpenFileDescription(pipeFile, FileOpenMode.WRITE, filePath, proc);
        const readerId = proc.addFileDescriptor(reader);
        const writerId = proc.addFileDescriptor(writer);
        return {readerId, writerId};
    }

    procGetFileStatus(proc, path) {
        const parts = resolvePath(proc.workingDirectory, path);
        const file = this._lookupFile(parts);

        if (file === undefined) {
            throw new SysError(`no such file: '${path}'`);
        }
        return file.getStatus();
    }

    procChangeWorkingDirectory(proc, path) {
        const parts = resolvePath(proc.workingDirectory, path);
        const file = this._lookupFile(parts);
        if (file == null) {
            throw new SysError(`no such file: ${path}`);
        }
        if (file.getStatus().type !== FileType.DIRECTORY) {
            throw new SysError(`not directory: '${path}'`, Errno.NOTDIR);
        }
        proc.workingDirectory = "/" + parts.join("/");
    }

    procListDirectory(proc, path) {
        assert(path != null);
        const parts = resolvePath(proc.workingDirectory, path);

        const file = this._lookupFile(parts);
        if (file.getStatus().type === FileType.DIRECTORY) {
            return Object.keys(file.dirEntries());
        } else {
            throw new SysError(`not directory: '${path}'`, Errno.NOTDIR)
        }
    }

    procSpawn(proc, programPath, args, fds, pgid) {

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

            // Inherit the parent's working directory
            const workingDirectory = proc.workingDirectory;

            return this._spawnProcess({programPath, args, fds: fileDescriptors, parent: proc, pgid, sid, workingDirectory});
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
            this._sendSignalToProcess(signal, receiverProc);
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
                this._sendSignalToProcess(signal, proc);
                foundSome = true;
            }
        }
        if (!foundSome) {
            console.log(`Couldn't send signal ${signal} to non-existent process group ${pgid}`);
        }
    }

    _sendSignalToProcess(signal, proc) {
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
        this._pseudoTerminals[proc.sid] = pty;

        const master = this._addOpenFileDescription(pty.master, FileOpenMode.READ_WRITE, `[master:${proc.sid}]`, proc);
        const slave = this._addOpenFileDescription(pty.slave, FileOpenMode.READ_WRITE, `[slave:${proc.sid}]`, proc);

        const masterId = proc.addFileDescriptor(master);
        const slaveId = proc.addFileDescriptor(slave);

        return {master: masterId, slave: slaveId};
    }

    removePseudoTerminal(sid) {
        delete this._pseudoTerminals[sid];
        console.log("Pseudo terminal sids: ", Object.keys(this._pseudoTerminals));
    }
    
    procOpenPseudoTerminalSlave(proc) {
        const pty = this._pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal connected to session");
        }
        const slave = this._addOpenFileDescription(pty.openNewSlave(), FileOpenMode.READ_WRITE, `[slave:${proc.sid}]`, proc);
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
