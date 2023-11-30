"use strict";

let backgroundedJobs = [];
let history;

async function main(args) {

    const configStreamId = await syscall("openFile", {fileName: "config.json"});
    let config = await read(configStreamId);
    await syscall("closeStream", {streamId: configStreamId});
    config = JSON.parse(config)
    const prompt = config.prompt;

    await syscall("configurePseudoTerminal", {mode: "CHARACTER"});

    await writeln(`Welcome. ${ANSI_CSI}36;45mType${ANSI_CSI}39;49m ${ANSI_CSI}31;44mhelp${ANSI_CSI}39;49m to get started.`);

    history = new History();

    async function getInputLine() {
        let editLine = new TextWithCursor();
        
        const [_line, startCol] = await stdlib.terminal.getCursorPosition();

        function line() {
            return `${ansiSetCursorHorizontalAbsolute(startCol)}${ANSI_ERASE_LINE_TO_RIGHT}${prompt}${editLine.text}`;
        }

        while (true) {
            
            await write(line() + ansiSetCursorHorizontalAbsolute(startCol + prompt.length + editLine.cursor));

            let received = await read();

            while (received != "") {
                let matched;
                let enter = false;
                let ctrlD = false;
                let ctrlC = false;
                let up = false;
                let down = false;
                if (received[0] == ASCII_BACKSPACE) {
                    editLine.backspace();
                    matched = 1;
                } else if (received[0] == "\n") {
                    enter = true;
                    matched = 1;
                } else if (received[0] == ASCII_END_OF_TRANSMISSION) {
                    ctrlD = true;
                    matched = 1;
                } else if (received[0] == ASCII_END_OF_TEXT) {
                    ctrlC = true;
                    matched = 1;
                } else if (received[0] == ASCII_CARRIAGE_RETURN) {
                    editLine.moveToStart();
                    matched = 1;
                } else if (received.startsWith(ANSI_CURSOR_BACK)) {
                    log("MOVE LEFT"); // TODO
                    editLine.moveLeft();
                    matched = ANSI_CURSOR_BACK.length;
                } else if (received.startsWith(ANSI_CURSOR_FORWARD)) {
                    editLine.moveRight();
                    matched = ANSI_CURSOR_FORWARD.length;
                } else if (received.startsWith(ANSI_CURSOR_END_OF_LINE)) {
                    editLine.moveToEnd();
                    matched = ANSI_CURSOR_END_OF_LINE.length;
                } else if (received.startsWith(ANSI_CURSOR_UP)) {
                    up = true;
                    matched = ANSI_CURSOR_UP.length;
                } else if (received.startsWith(ANSI_CURSOR_DOWN)) {
                    down = true;
                    matched = ANSI_CURSOR_DOWN.length;
                } else {
                    editLine.insert(received[0]);
                    matched = 1;
                } 
    
                received = received.slice(matched);
    
                if (enter) {
                    await write(line() + "\n");
                    history.onEnter(editLine.text);
                    const enteredLine = editLine.text;
                    editLine.reset();
                    return enteredLine;
                } else if (ctrlC) {
                    await write(line() + "^C\n");
                    history.clearSelection();
                    editLine.reset();
                    return "";
                } else if (ctrlD) {
                    await write(line() + "^D\n");
                    await syscall("exit");
                    editLine.reset();
                    return "";
                } else if (up) {
                    const selectedLine = history.onCursorUp();
                    if (selectedLine != null) {
                        editLine.text = selectedLine;
                        editLine.moveToEnd();
                    } else {
                        editLine.reset();
                    }
                } else if (down) {
                    const selectedLine = history.onCursorDown();
                    if (selectedLine != null) {
                        editLine.text = selectedLine;
                        editLine.moveToEnd();
                    } else {
                        editLine.reset();
                    }
                }
            }
        }
    }
    
    while (true) {
        const inputLine = await getInputLine();
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
        let pids = [];
        
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
                if (redirectOutputTo === null) {
                    stdout = shellStdout;
                } else {
                    const outputFileStreamId = await syscall("openFile", {fileName: redirectOutputTo, createIfNecessary: true});
                    stdout = outputFileStreamId;
                }
            } else {
                const pipe = await syscall("createPipe");
                pipedStdin = pipe.readerId;
                stdout = pipe.writerId;
            }

            const {program, args} = commands[i];

            if (i == 0) {
                // The first process in the pipeline becomes process group leader.
                pgid = "START_NEW";
            }

            const pid = await syscall("spawn", {program, args, streamIds: [stdin, stdout], pgid});

            // Once a stream has been duplicated in the child, we close our version.
            // For pipes, this is needed to ensure correct behaviour when the child closes their version.
            // https://man7.org/linux/man-pages/man7/pipe.7.html
            if (stdin != shellStdin) {
                await syscall("closeStream", {streamId: stdin});
            }
            if (stdout != shellStdout) {
                await syscall("closeStream", {streamId: stdout});
            }

            pids.push(pid);

            if (i == 0) {
                // All remaining processes in the pipeline join the newly created process group.
                pgid = pid;
            }
        }
        
        const job = {pgid, pids};
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

        const fileNames = await syscall("listFiles");
        await writeln(ansiBackgroundColor("Files:", 44));
        for (let fileName of fileNames) {
            await write(`${fileName}  `);
        }
        await writeln("");
    },

    textcolor: async function(args) {
        if (args.length >= 1) {
            await stdlib.terminal.setTextStyle(args[0]);
        } else {
            await writeError("missing color argument");
        }
    },

    bgcolor: async function(args) {
        if (args.length >= 1) {
            await stdlib.terminal.setBackgroundStyle(args[0]);
        } else {
            await writeError("missing color argument");
        }
    },

    clear: async function(args) {
        await stdlib.terminal.clear();
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
        for (let i = 0; i < history.lines.length; i++) {
            await writeln(`${i + 1}: ${history.lines[i]}`);
        }
    }
}

async function runJobInForeground(job) {

    // Programs we spawn expect the terminal to be in line mode. If they want raw mode, they will configure it.
    await syscall("configurePseudoTerminal", {mode: "LINE"});

    // Give the terminal to the new foreground group
    await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: job.pgid});
    const lastPid = job.pids.slice(-1)[0];
    for (let i = job.pids.length - 1; i >= 0; i--) {
        const pid = job.pids[i];
        try {
            await syscall("waitForExit", {pid});
        } catch (e) {
            console.log(`Shell caught error when waiting for foreground process ${pid}: `, e);
        }
    }
   
    // Reclaim the terminal
    await syscall("setForegroundProcessGroupOfPseudoTerminal", {toSelf: true});
    await syscall("configurePseudoTerminal", {mode: "CHARACTER"});
}

async function parse(line) {
    
    const remainingWords = line.split(' ').filter(w => w !== '');

    let pipeline = null;
    let builtin = null;
    let redirectOutputTo = null;

    const fileNames = await syscall("listFiles");

    let command = null;
    let args = [];
    while (remainingWords.length > 0) {
        const word = remainingWords.shift();
        if (command == null && builtin == null) {
            if (word in builtins) {
                builtin = {name: word}
            } else if (fileNames.includes(word)) {
                if (pipeline == null) {
                    pipeline = {commands: []};
                }
                command = {program: word};
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

                const fileName = remainingWords.shift();
                redirectOutputTo = fileName;
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

class History {
    constructor() {
        this.lines = [];
        this.selected = null;
    }

    onEnter(line) {
        if (line != "") {
            this.lines.push(line);
        }
        this.selected = null;
    }
    
    clearSelection() {
        this.selected = null;
    }

    onCursorUp() {
        if (this.selected != null) {
            this.selected -= 1;
        } else {
            this.selected = this.lines.length - 1;
        }
        if (this.selected >= 0) {
            const line = this.lines[this.selected];
            return line;
        } else {
            this.selected = null;
            return null;
        }
    }

    onCursorDown() {
        if (this.selected != null) {
            this.selected += 1;
        } else {
            this.selected = 0;
        }
        if (this.selected < this.lines.length) {
            const line = this.lines[this.selected];
            return line;
        } else {
            this.selected = null;
            return null;
        }
    }
}