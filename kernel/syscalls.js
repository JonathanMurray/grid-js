
function validateSyscallArgs(args, required, optional) {
    for (let requiredArg of required) {
        if (!(requiredArg in args)) {
            throw new SyscallError(`missing syscall argument: '${requiredArg}'. args=${JSON.stringify(args)}`)
        }
    }
    for (let argName in args) {
        if (!(required.includes(argName) || optional.includes(argName))) {
            throw new SyscallError(`unexpected syscall argument: '${argName}=${args[argName]}'. allowed=${required.concat(optional)}`)
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
            throw new SyscallError("only session leader can create a pseudoterminal")
        }
        if (proc.pid != proc.pgid) {
            throw new SyscallError("only process group leader can create a pseudoterminal")
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
            throw new SyscallError(`exactly one of pgid and toSelf should be set. pgid=${pgid}, toSelf=${toSelf}`);
        }
        const proc = this.system.process(pid);
        const pty = this.system.pseudoTerminals[proc.sid];
        if (pty == undefined) {
            throw new SyscallError("no pseudoterminal is controlled by this process' session")
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
            throw new SyscallError("no pseudoterminal is controlled by this process' session")
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
        let procs = [];
        for (let pid of Object.keys(this.system.processes)) {
            const proc = this.system.process(pid);
            procs.push({pid, ppid: proc.ppid, programName: proc.programName, pgid: proc.pgid});
        }
        return procs;
    }

    exit(args, pid) {
        console.assert(pid != undefined);
        return this.system.onProcessExit(pid);
    }

    sendSignal(args, senderPid) {

        const {signal, pid, pgid} = validateSyscallArgs(args, ["signal"], ["pid", "pgid"]);

        if ((pid == undefined && pgid == undefined) || (pid != undefined && pgid != undefined)) {
            throw new SyscallError(`exactly one of pid and pgid should be set. pid=${pid}, pgid=${pgid}`);
        }

        if (pid != undefined) {
            if (pid == senderPid) {
                // TODO: shouldn't be able to kill ancestors either?
                throw new SyscallError("process cannot kill itself");
            }
            const proc = this.system.process(pid);
            if (proc != undefined) {
                this.system.sendSignalToProcess(signal, proc);
            } else {
                throw new SyscallError("no such process");
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

    async read(args, pid) {
        const {streamId} = validateSyscallArgs(args, ["streamId"]);
        const proc = this.system.process(pid);
        return proc.read(streamId);
    }

    readAny(args, pid) {
        const {streamIds} = validateSyscallArgs(args, ["streamIds"]);
        const proc = this.system.process(pid);
        return proc.readAny(streamIds);
    }

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

    async spawn(args, ppid) {
        let {program, args: programArgs, streamIds, pgid} = validateSyscallArgs(args, ["program"], ["args", "streamIds", "pgid"]);

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
        } else {
            // Inherit the parent's streams
            streams = Object.assign({}, parentProc.streams);
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
        
        const childPid = await this.system.spawnProcess({programName: program, args: programArgs, streams, ppid, pgid, sid});

        return childPid;
    }

    waitForExit(pidToWaitFor, pid) {
        const proc = this.system.process(pid);
        const procToWaitFor = this.system.process(pidToWaitFor);
        if (proc) {
            console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
            return proc.waitForOtherToExit(procToWaitFor);
        }
        console.debug("Process doesn't exist / has already exited");
    }

    graphics(args, pid) {
        let {title, size} = validateSyscallArgs(args, ["title", "size"]);
        this.system.windowManager.makeWindowVisible(title, size, pid);
    }

    sleep(args, pid) {
        let {millis} = validateSyscallArgs(args, ["millis"]);
        const proc = this.system.process(pid);
        return proc.sleep(millis);
    }
}
