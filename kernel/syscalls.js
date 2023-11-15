
function validateSyscallArgs(args, required, optional) {
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

    joinNewSessionAndProcessGroup(args, pid) {
        const proc = this.system.process(pid);
        // Note that this has no effect if the process is already session leader and process group leader.
        proc.sid = proc.pid;
        proc.pgid = proc.pid;
    }

    createPseudoTerminal(args, pid) {
        const proc = this.system.process(pid);
        if (proc.pid != proc.sid) {
            throw new SysError("only session leader can create a pseudoterminal")
        }
        if (proc.pid != proc.pgid) {
            throw new SysError("only process group leader can create a pseudoterminal")
        }
        const pty = this.system.createPseudoTerminal(proc.sid);

        const masterReaderId = proc.addStream(new PipeReader(pty.slaveToMaster));
        const masterWriterId = proc.addStream(new PipeWriter(pty.masterToSlave));
        const slaveReaderId = proc.addStream(new PipeReader(pty.masterToSlave));
        const slaveWriterId = proc.addStream(new PipeWriter(pty.slaveToMaster));

        return {masterReaderId, masterWriterId, slaveReaderId, slaveWriterId};
    }

    setForegroundProcessGroupOfPseudoTerminal(args, pid) {
        let {pgid, toSelf} = validateSyscallArgs(args, [], ["pgid", "toSelf"]);
        if ((pgid == undefined && toSelf == undefined) || (pgid != undefined && toSelf != undefined)) {
            throw new SysError(`exactly one of pgid and toSelf should be set. pgid=${pgid}, toSelf=${toSelf}`);
        }
        const proc = this.system.process(pid);
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal is controlled by this process' session")
        }
        if (toSelf) {
            pgid = proc.pgid;
        }
        pty.setForegroundPgid(pgid);
    }

    getForegroundProcessGroupOfPseudoTerminal(args, pid) {
        const proc = this.system.process(pid);
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SysError("no pseudoterminal is controlled by this process' session")
        }
        return pty.foreground_pgid;
    }

    createPipe(args, pid) {
        const proc = this.system.process(pid);

        const pipe = new Pipe();

        const readerId = proc.addStream(new PipeReader(pipe));
        const writerId = proc.addStream(new PipeWriter(pipe));

        return {readerId, writerId};
    }

    listProcesses(args, pid) {
        return this.system.listProcesses();
    }

    exit(args, pid) {
        console.assert(pid != undefined);
        return this.system.onProcessExit(args, pid);
    }

    sendSignal(args, senderPid) {

        const {signal, pid, pgid} = validateSyscallArgs(args, ["signal"], ["pid", "pgid"]);

        if ((pid == undefined && pgid == undefined) || (pid != undefined && pgid != undefined)) {
            throw new SysError(`exactly one of pid and pgid should be set. pid=${pid}, pgid=${pgid}`);
        }

        if (pid != undefined) {
            if (pid == senderPid) {
                // TODO: shouldn't be able to kill ancestors either?
                throw new SysError("process cannot kill itself");
            }
            const proc = this.system.process(pid);
            if (proc != undefined) {
                this.system.sendSignalToProcess(signal, proc);
            } else {
                throw new SysError("no such process");
            }
        } else if (pgid != undefined) {
            this.system.sendSignalToProcessGroup(signal, pgid);
        }
    }

    ignoreInterruptSignal(args, pid) {
        const proc = this.system.process(pid);
        proc.interruptSignalBehaviour = InterruptSignalBehaviour.IGNORE;
    }

    handleInterruptSignal(args, pid) {
        const proc = this.system.process(pid);
        proc.interruptSignalBehaviour = InterruptSignalBehaviour.HANDLE;
    }

    write(args, pid) {
        const {text, streamId} = validateSyscallArgs(args, ["text", "streamId"]);
        const proc = this.system.process(pid);
        return proc.write(streamId, text);
    }

    read(args, pid) {
        const {streamId} = validateSyscallArgs(args, ["streamId"]);
        const proc = this.system.process(pid);
        return proc.read(streamId);
    }

    close(args, pid) {
        const {streamId} = validateSyscallArgs(args, ["streamId"]);
        const proc = this.system.process(pid);
        return proc.closeStream(streamId);
    }

    /*
    readAny(args, pid) {
        const {streamIds} = validateSyscallArgs(args, ["streamIds"]);
        const proc = this.system.process(pid);
        return proc.readAny(streamIds);
    }
    */

    listFiles(args, pid) {
        return Object.keys(this.system.files);
    }

    saveToFile(args, pid) {
        const {lines, fileName} = validateSyscallArgs(args, ["lines", "fileName"]);
        return this.system.saveLinesToFile(lines, fileName);
    }

    readFromFile(fileName, pid) {
        return this.system.readLinesFromFile(fileName);
    }

    spawn(args, ppid) {
        let {program, args: programArgs, streamIds, pgid} = validateSyscallArgs(args, ["program"], ["args", "streamIds", "pgid"]);

        if (programArgs == undefined) {
            programArgs = [];
        }

        const parentProc = this.system.process(ppid);

        let streams = {};
        if (streamIds != undefined) {
            for (let i = 0; i < streamIds.length; i++) {
                let stream;
                if (streamIds[i] == "NULL_STREAM") {
                    stream = new NullStream();
                } else {
                    const parentStreamId = parseInt(streamIds[i]);
                    stream = parentProc.streams[parentStreamId].duplicate();
                }
                console.assert(stream != undefined);
                streams[i] = stream;
            }
        } else {
            // Inherit the parent's streams
            for (let i in parentProc.streams) {
                streams[i] = parentProc.streams[i].duplicate();
            }
        }

        if (pgid != "START_NEW") {
            if (pgid != undefined) {
                // TODO: Should only be allowed if that group belongs to the same session as this process
                // Join a specific existing process group
                pgid = parseInt(pgid);
            } else {
                // Join the parent's process group
                pgid = parentProc.pgid;
            }
        }

        // Join the parent's session
        const sid = parentProc.sid;
        
        return this.system.spawnProcess({programName: program, args: programArgs, streams, ppid, pgid, sid});
    }

    waitForExit(pidToWaitFor, pid) {
        if (!Number.isInteger(pidToWaitFor)) {
            throw new SysError(`invalid syscall arg. Expected int but got: ${JSON.stringify(pidToWaitFor)}`)
        }
        return this.system.waitForOtherProcessToExit(pid, pidToWaitFor);
    }

    graphics(args, pid) {
        let {title, size} = validateSyscallArgs(args, ["title", "size"]);
        this.system.makeWindowVisible(title, size, pid);
    }

    sleep(args, pid) {
        let {millis} = validateSyscallArgs(args, ["millis"]);
        const proc = this.system.process(pid);
        return proc.sleep(millis);
    }
}
