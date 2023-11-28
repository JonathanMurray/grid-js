
function validateSyscallArgs(args, required, optional=[]) {
    if (typeof args != "object") {
        throw new SysError(`unexpected syscall argument: '${args}'. allowed=${required.concat(optional)}`)
    }

    for (let requiredArg of required) {
        if (!(requiredArg in args)) {
            throw new SysError(`missing syscall argument: '${requiredArg}'. args=${JSON.stringify(args)}`)
        }
    }
    for (let argName in args) {
        if (!(required.includes(argName) || optional.includes(argName))) {
            throw new SysError(`unexpected syscall argument: '${argName}=${args[argName]}'. allowed=${required.concat(optional)}`)
        }
    }
    return args;
}

class Syscalls {
    constructor(system) {
        this.system = system;
    }

    joinNewSessionAndProcessGroup(proc, args) {
        // Note that this has no effect if the process is already session leader and process group leader.
        proc.sid = proc.pid;
        proc.pgid = proc.pid;
    }

    createPseudoTerminal(proc, args) {
        return this.system.createPseudoTerminal(proc);
    }

    configurePseudoTerminal(proc, args) {
        return this.system.configurePseudoTerminal(proc, args);
    }

    getTerminalSize(proc, args) {
        return this.system.getTerminalSize(proc);
    }

    setForegroundProcessGroupOfPseudoTerminal(proc, args) {
        let {pgid, toSelf} = validateSyscallArgs(args, [], ["pgid", "toSelf"]);
        if ((pgid == undefined && toSelf == undefined) || (pgid != undefined && toSelf != undefined)) {
            throw new SysError(`exactly one of pgid and toSelf should be set. pgid=${pgid}, toSelf=${toSelf}`);
        }
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal is controlled by this process' session")
        }
        if (toSelf) {
            pgid = proc.pgid;
        }
        pty.setForegroundPgid(pgid);
    }

    getForegroundProcessGroupOfPseudoTerminal(proc, args) {
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal is controlled by this process' session")
        }
        return pty.foreground_pgid;
    }

    createPipe(proc, args) {
        const pipe = new Pipe();

        const readerId = proc.addStream(new PipeReader(pipe));
        const writerId = proc.addStream(new PipeWriter(pipe));

        return {readerId, writerId};
    }

    listProcesses(proc, args) {
        return this.system.listProcesses();
    }

    exit(proc, exitValue) {
        return this.system.onProcessExit(proc, exitValue);
    }

    sendSignal(proc, args) {

        const {signal, pid, pgid} = validateSyscallArgs(args, ["signal"], ["pid", "pgid"]);

        if ((pid == undefined && pgid == undefined) || (pid != undefined && pgid != undefined)) {
            throw new SysError(`exactly one of pid and pgid should be set. pid=${pid}, pgid=${pgid}`);
        }

        if (pid != undefined) {
            if (pid == proc.pid) {
                // TODO: shouldn't be able to kill ancestors either?
                throw new SysError("process cannot kill itself");
            }
            const receiverProc = this.system.process(pid);
            if (receiverProc != undefined) {
                this.system.sendSignalToProcess(signal, receiverProc);
            } else {
                throw new SysError("no such process");
            }
        } else if (pgid != undefined) {
            this.system.sendSignalToProcessGroup(signal, pgid);
        }
    }

    ignoreInterruptSignal(proc, args) {
        proc.interruptSignalBehaviour = SignalBehaviour.IGNORE;
    }

    handleInterruptSignal(proc, args) {
        proc.interruptSignalBehaviour = SignalBehaviour.HANDLE;
    }

    write(proc, args) {
        const {text, streamId} = validateSyscallArgs(args, ["text", "streamId"]);
        return proc.write(streamId, text);
    }

    read(proc, args) {
        const {streamId, nonBlocking} = validateSyscallArgs(args, ["streamId"], ["nonBlocking"]);
        return proc.read(streamId, nonBlocking);
    }

    openFile(proc, args) {
        let {fileName, createIfNecessary} = validateSyscallArgs(args, ["fileName"], ["createIfNecessary"]);
        if (createIfNecessary == undefined) {
            createIfNecessary = false;
        }
        return this.system.procOpenFile(proc, fileName, createIfNecessary);
    }

    setFileLength(proc, args) {
        const {streamId, length} = validateSyscallArgs(args, ["streamId", "length"]);
        return this.system.procSetFileLength(proc, streamId, length);
    }

    closeStream(proc, args) {
        const {streamId} = validateSyscallArgs(args, ["streamId"]);
        return proc.closeStream(streamId);
    }

    /*
    readAny(proc, args) {
        const {streamIds} = validateSyscallArgs(args, ["streamIds"]);
        return proc.readAny(streamIds);
    }
    */

    listFiles(proc, args) {
        return Object.keys(this.system.files);
    }

    spawn(proc, args) {
        let {program, args: programArgs, streamIds, pgid} = validateSyscallArgs(args, ["program"], ["args", "streamIds", "pgid"]);

        if (programArgs == undefined) {
            programArgs = [];
        }

        let streams = {};
        if (streamIds != undefined) {
            for (let i = 0; i < streamIds.length; i++) {
                let stream;
                if (streamIds[i] == "NULL_STREAM") {
                    stream = new NullStream();
                } else {
                    const parentStreamId = parseInt(streamIds[i]);
                    stream = proc.streams[parentStreamId].duplicate();
                }
                assert(stream != undefined);
                streams[i] = stream;
            }
        } else {
            // Inherit the parent's streams
            for (let i in proc.streams) {
                streams[i] = proc.streams[i].duplicate();
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
        
        return this.system.spawnProcess({programName: program, args: programArgs, streams, ppid: proc.pid, pgid, sid});
    }

    waitForExit(proc, args) {
        let {pid, nonBlocking} = validateSyscallArgs(args, ["pid"], ["nonBlocking"]);
        if (!Number.isInteger(pid)) {
            throw new SysError(`invalid pid arg: ${JSON.stringify(pid)}`)
        }

        return this.system.waitForOtherProcessToExit(proc.pid, pid, nonBlocking);
    }

    graphics(proc, args) {
        let {title, size, resizable, menubarItems} = validateSyscallArgs(args, ["title", "size", "resizable"], ["menubarItems"]);
        menubarItems = menubarItems || [];
        return this.system.createWindow(title, size, proc, resizable, menubarItems);
    }

    sleep(proc, args) {
        let {millis} = validateSyscallArgs(args, ["millis"]);
        return proc.sleep(millis);
    }
}
