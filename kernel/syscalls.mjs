import { SysError } from "./errors.mjs";
import { SignalBehaviour } from "./process.mjs";
import { System } from "./system.mjs"
import { FileOpenMode } from "/shared.mjs";

function validateSyscallArgs(args, required, optional=[]) {
    if (typeof args != "object") {
        throw {name: "SysError", message: `unexpected syscall argument: '${args}'. allowed=${required.concat(optional)}`};
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

export class Syscalls {
    
/**
 * @param {System} system
 */
    constructor(system) {
        this.system = system;
    }

    joinNewSessionAndProcessGroup(proc, args) {
        proc.joinNewSessionAndProcessGroup();
    }

    /** PTY ------------------------------------- */
    createPseudoTerminal(proc, args) {
        return this.system.createPseudoTerminal(proc);
    }
    
    openPseudoTerminalSlave(proc, args) {
        return this.system.procOpenPseudoTerminalSlave(proc);
    }

    configurePseudoTerminal(proc, args) {
        return this.system.controlPseudoTerminal(proc, args);
    }

    // TODO: Replace specific pty syscalls with generic iotcl call
    setPtyForegroundPgid(proc, args) {
        let {pgid, toSelf} = validateSyscallArgs(args, [], ["pgid", "toSelf"]);
        if ((pgid == undefined && toSelf == undefined) || (pgid != undefined && toSelf != undefined)) {
            throw new SysError(`exactly one of pgid and toSelf should be set. pgid=${pgid}, toSelf=${toSelf}`);
        }
        if (toSelf) {
            pgid = proc.pgid;
        }
        return this.system.controlPseudoTerminal(proc, {setForegroundPgid: pgid});
    }

    getPtyForegroundPgid(proc, args) {
        return this.system.controlPseudoTerminal(proc, {getPtyForegroundPgid: {}});
    }
    
    getTerminalSize(proc, args) {
        return this.system.controlPseudoTerminal(proc, {getTerminalSize: {}});
    }
    /** ------------------------------------------ */


    createPipe(proc, args) {
        return this.system.procCreateUnnamedPipe(proc);
    }

    listProcesses(proc, args) {
        return this.system.listProcesses();
    }

    exit(proc, args) {
        return this.system.onProcessExit(proc, args);
    }

    sendSignal(proc, args) {
        const {signal, pid} = validateSyscallArgs(args, ["signal", "pid"]);
        this.system.procSendSignalToProcess(proc, signal, pid);
    }

    sendSignalToProcessGroup(proc, args) {
        const {signal, pgid} = validateSyscallArgs(args, ["signal", "pgid"]);
        this.system.sendSignalToProcessGroup(signal, pgid);
    }

    ignoreInterruptSignal(proc, args) {
        proc.interruptSignalBehaviour = SignalBehaviour.IGNORE;
    }

    handleInterruptSignal(proc, args) {
        proc.interruptSignalBehaviour = SignalBehaviour.HANDLE;
    }

    write(proc, args) {
        const {text, fd} = validateSyscallArgs(args, ["text", "fd"]);
        return proc.write(fd, text);
    }

    read(proc, args) {
        const {fd, nonBlocking} = validateSyscallArgs(args, ["fd"], ["nonBlocking"]);
        return proc.read(fd, nonBlocking);
    }

    openFile(proc, args) {
        let {filePath, createIfNecessary, mode} = validateSyscallArgs(args, ["filePath"], ["createIfNecessary", "mode"]);
        if (mode == null) {
            mode = FileOpenMode.READ_WRITE;
        }
        return this.system.procOpenFile(proc, filePath, {createIfNecessary, mode});
    }

    getFileStatus(proc, args) {
        let {path, fd} = validateSyscallArgs(args, [], ["path", "fd"]);
        if (fd != null) {
            return proc.getFileDescriptorStatus(fd);
        } else if (path != null) {
            return this.system.procGetFileStatus(proc, path);
        } else {
            throw new SysError("missing path or fd argument");
        }
    }

    seekInFile(proc, args) {
        let {fd, position} = validateSyscallArgs(args, ["fd", "position"]);
        proc.seekInFile(fd, position);
    }

    setFileLength(proc, args) {
        const {fd, length} = validateSyscallArgs(args, ["fd", "length"]);
        return proc.setFileLength(fd, length);
    }

    close(proc, args) {
        const {fd} = validateSyscallArgs(args, ["fd"]);
        return proc.close(fd);
    }

    pollRead(proc, args) {
        const {fds, timeoutMillis} = validateSyscallArgs(args, ["fds"], ["timeoutMillis"]);
        return proc.pollRead(fds, timeoutMillis);
    }

    changeWorkingDirectory(proc, args) {
        const {path} = validateSyscallArgs(args, ["path"]);
        return this.system.procChangeWorkingDirectory(proc, path);
    }

    getWorkingDirectory(proc, args) {
        return proc.workingDirectory;
    }

    listDirectory(proc, args) {
        const {path} = validateSyscallArgs(args, ["path"]);
        return this.system.procListDirectory(proc, path);
    }

    spawn(proc, args) {
        let {programPath, args: programArgs, fds, pgid} = validateSyscallArgs(args, ["programPath"], ["args", "fds", "pgid"]);

        if (programArgs == undefined) {
            programArgs = [];
        }

        return this.system.procSpawn(proc, programPath, programArgs, fds, pgid);
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
        return this.system.procSetupGraphics(proc, title, size, resizable, menubarItems);
    }

    sleep(proc, args) {
        let {millis} = validateSyscallArgs(args, ["millis"]);
        return proc.sleep(millis);
    }
}
