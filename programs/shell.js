"use strict";

import { read, writeln, write, log, writeError, terminal, readEntireFile } from "/lib/stdlib.mjs";
import { ANSI_CSI, TextWithCursor, ansiSetCursorHorizontalAbsolute, ANSI_ERASE_LINE_TO_RIGHT, ASCII_BACKSPACE, ASCII_END_OF_TRANSMISSION, ASCII_END_OF_TEXT, ASCII_CARRIAGE_RETURN, ANSI_CURSOR_BACK, ANSI_CURSOR_FORWARD, ANSI_CURSOR_END_OF_LINE, ANSI_CURSOR_UP, ANSI_CURSOR_DOWN, ansiBackgroundColor, ansiColor, FileOpenMode } from "/shared.mjs";

import { syscall } from "/lib/sys.mjs";
import { reportCrash} from "/lib/errors.mjs";
import { Readline } from "/lib/readline.mjs";

let backgroundedJobs = [];
const readline = new Readline();

async function main(args) {

    let config = await readEntireFile("/config.json");
    config = JSON.parse(config)
    let prompt = config.prompt;

    await writeln(`Welcome. ${ANSI_CSI}36;45mType${ANSI_CSI}39;49m ${ANSI_CSI}31;44mhelp${ANSI_CSI}39;49m to get started.`);
    
    while (true) {
        const workingDir = await syscall("getWorkingDirectory");
        prompt = ansiColor("{", 35) + workingDir + ansiColor("}", 35) + " ";
        const inputLine = await readline.readLine(prompt, `{${workingDir}} `.length);
        if (inputLine === null) {
            // EOF
            return;
        }
        await handleInputLine(inputLine);
    }
}

async function handleInputLine(input) {

    const words = input.split(' ').filter(w => w !== '');

    if (words.length == 0) {
        return;
    }

    let parsed;
    try {
        parsed = await parse(input);
    } catch (error) {
        if (error instanceof ParseError) {
            await writeError(error.message);
            return;
        }
        throw error;
    }

    const {builtin, pipeline, redirectOutputTo} = parsed;

    if (builtin) {
        await builtins[builtin.name](builtin.args);
    } else {
        const {commands, runInBackground} = pipeline;

        const shellStdin = 0;
        const shellStdout = 1;
        let pipedStdin;

        let pgid = null;
        let jobEntries = [];

        let finalStdout;
        if (redirectOutputTo == null) {
            finalStdout = shellStdout;
        } else {
            try {
                finalStdout = await syscall("openFile", {path: redirectOutputTo, createIfNecessary: true, mode: FileOpenMode.WRITE});
            } catch (e) {
                writeError(e["message"]);
                return;
            }
        }

        for (let i = 0; i < commands.length; i++) {

            let stdin;
            let stdout;

            if (i == 0) {
                stdin = shellStdin;
            } else {
                console.assert(pipedStdin != undefined);
                stdin = pipedStdin;
            }

            if (i == commands.length - 1) {
                stdout = finalStdout;
            } else {
                const pipe = await syscall("createPipe");
                pipedStdin = pipe.readerId;
                stdout = pipe.writerId;
            }

            const {programPath, args} = commands[i];

            if (i == 0) {
                // The first process in the pipeline becomes process group leader.
                pgid = "START_NEW";
            }

            let pid;
            try {
                pid = await syscall("spawn", {programPath, args, fds: [stdin, stdout], pgid});
            } catch (e) {
                await writeError(e["message"]);
                return;
            }

            // Once a stream has been duplicated in the child, we close our version.
            // For pipes, this is needed to ensure correct behaviour when the child closes their version.
            // https://man7.org/linux/man-pages/man7/pipe.7.html
            if (stdin != shellStdin) {
                await syscall("close", {fd: stdin});
            }
            if (stdout != shellStdout) {
                await syscall("close", {fd: stdout});
            }

            jobEntries.push({pid, programPath});

            if (i == 0) {
                // All remaining processes in the pipeline join the newly created process group.
                pgid = pid;
            }
        }
        
        const job = {pgid, procs: jobEntries};
        if (runInBackground) {
            backgroundedJobs.push(job);
        } else {
            await runJobInForeground(job);
        }
    }
}


const builtins = {
    help: async function(args) {

        await writeln(ansiBackgroundColor("Shell builtins:", 44));
        for (let name of Object.keys(builtins)) {
            await writeln(`  ${name}`);
        }

        const programFiles = await syscall("listDirectory", {path: "/bin"});
        await writeln(ansiBackgroundColor("Programs:", 44));
        for (let name of programFiles) {
            if (![".", ".."].includes(name)) {
                await write(`${name}  `);
            }
        }
        await writeln("");
    },

    textcolor: async function(args) {
        if (args.length >= 1) {
            await terminal.setTextStyle(args[0]);
        } else {
            await writeError("missing color argument");
        }
    },

    bgcolor: async function(args) {
        if (args.length >= 1) {
            await terminal.setBackgroundStyle(args[0]);
        } else {
            await writeError("missing color argument");
        }
    },

    clear: async function(args) {
        await terminal.clear();
    },

    cd: async function(args) {
        const path = args[0] || "/";
        try {
            await syscall("changeWorkingDirectory", {path})
        } catch (e) {
            writeError(e["message"]);
        }
    },

    pwd: async function(args) {
        const path = await syscall("getWorkingDirectory");
        await writeln(path);
    },

    fg: async function(args) {
        const job = backgroundedJobs.shift();
        if (job != undefined) {
            await writeln(`pgid=${job.pgid}, pids=${job.pids}`);
            await runJobInForeground(job);
        }  else {
            await writeln("<no background processes>");
        }
    },

    jobs: async function(args) {
        if (backgroundedJobs.length > 0) {
            await writeln("Background jobs:");
            for (let job of backgroundedJobs) {
                await writeln(`pgid=${job.pgid}, pids=${job.pids}`);
            }
        } else {
            await writeln("<no background processes>");
        }
    },

    history: async function(args) {
        const history = readline.history;
        for (let i = 0; i < history.lines.length; i++) {
            await writeln(`${i + 1}: ${history.lines[i]}`);
        }
    }
}

async function runJobInForeground(job) {

    // Give the terminal to the new foreground group
    await syscall("setPtyForegroundPgid", {pgid: job.pgid});
    for (let i = job.procs.length - 1; i >= 0; i--) {
        const pid = job.procs[i].pid;
        try {
            await syscall("waitForExit", {pid});
        } catch (e) {
            if (e["name"] == "WaitError") {
                for await (const line of reportCrash(pid, job.procs[i].programPath, e["exitError"])) {
                    writeln(line);
                }
            } else {
                throw e;
            }
        }
    }

    // Reclaim the terminal
    await syscall("setPtyForegroundPgid", {toSelf: true});
}

async function parse(line) {
    
    const remainingWords = line.split(' ').filter(w => w !== '');

    let pipeline = null;
    let builtin = null;
    let redirectOutputTo = null;

    const programNames = await syscall("listDirectory", {path: "/bin"});

    let command = null;
    let args = [];
    while (remainingWords.length > 0) {
        const word = remainingWords.shift();
        if (command == null && builtin == null) {
            if (word in builtins) {
                builtin = {name: word, args: null}
            } else if (programNames.includes(word)) {
                if (pipeline == null) {
                    pipeline = {commands: [], runInBackground: false};
                }
                command = {programPath: `/bin/${word}`, args: null};
            } else {
                throw new ParseError(`invalid command: ${word}`);
            }
        } else {
            if (word == "&") {
                if (remainingWords.length > 0) {
                    throw new ParseError("invalid syntax: & must occur last");
                }
                pipeline.runInBackground = true;
            } else if (word == "|") {
                command.args = args;
                args = [];
                pipeline.commands.push(command);
                command = null; // A new command will be parsed after the pipe symbol
                builtin = null;
            } else if (word == ">") {

                if (remainingWords.length == 0) {
                    throw new ParseError("invalid syntax: > must be followed by file name");
                }

                if (redirectOutputTo != null) {
                    throw new ParseError("invalid syntax: at most one > is allowed");
                }

                const filePath = remainingWords.shift();
                redirectOutputTo = filePath;
            } else {
                args.push(word);
            }
        }
    }

    if (command != null) {
        command.args = args;
        pipeline.commands.push(command);
    } else if (builtin != null) {
        builtin.args = args;
    } else {
        console.error("Found no command or builtin");
    }

    if (builtin != null) {
        if (pipeline != null) {
            throw new ParseError("builtins are not supported in pipeline");
        }
        if (redirectOutputTo != null) {
            throw new ParseError("builtins don't support output redirection");
        }
    }

    return {pipeline, builtin, redirectOutputTo};
}

class ParseError extends Error {
    constructor(message) {
        super(message);
        this.name = "ParseError";
    }
}
