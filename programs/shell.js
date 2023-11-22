"use strict";

const PROMPT = "> ";

let backgroundedJobs = [];
let history;

async function main(args) {

    await stdlib.terminal.setTextStyle("#0F0");
    await stdlib.terminal.setBackgroundStyle("black");
    await writeln("Welcome. Type help to get started.");
    await write(PROMPT);
    
    await syscall("configurePseudoTerminal", {mode: "CHARACTER"});
    
    let currentLine = new TextWithCursor();
    history = new History();
    while (true) {
        let received = await read();
        while (received != "") {
            let matched;
            let echo = true;
            if (received[0] == ASCII_BACKSPACE) {
                echo = currentLine.backspace();
                matched = 1;
            } else if (received[0] == "\n") {
                await write("\n");
                history.onEnter(currentLine.text);
                await handleInputLine(currentLine.text);
                currentLine.reset();
                echo = false;
                await write(PROMPT);
                matched = 1;
            } else if (received[0] == ASCII_END_OF_TRANSMISSION) {
                currentLine.reset();
                matched = 1;
                echo = false;
                await write("^D\n");
            } else if (received[0] == ASCII_END_OF_TEXT) {
                currentLine.reset();
                matched = 1;
                echo = false;
                await write(`^C\n${PROMPT}`);
                history.clearSelection();
            } else if (received[0] == ASCII_CARRIAGE_RETURN) {
                currentLine.moveToStart();
                echo = false;
                await write(ansiSetCursorPosition(PROMPT.length + 1));
                matched = 1;
            } else if (received.startsWith(ANSI_CURSOR_BACK)) {
                currentLine.moveLeft();
                echo = false;
                await write(ansiSetCursorPosition(PROMPT.length + 1 + currentLine.cursor));
                matched = ANSI_CURSOR_BACK.length;
            } else if (received.startsWith(ANSI_CURSOR_FORWARD)) {
                currentLine.moveRight();
                matched = ANSI_CURSOR_FORWARD.length;
            } else if (received.startsWith(ANSI_CURSOR_END_OF_LINE)) {
                currentLine.moveToEnd();
                matched = ANSI_CURSOR_END_OF_LINE.length;
            } else if (received.startsWith(ANSI_CURSOR_UP)) {
                echo = false;
                const selectedLine = history.onCursorUp();
                const prefix = `${ANSI_ERASE_ENTIRE_LINE}${ASCII_CARRIAGE_RETURN}${PROMPT}`;
                if (selectedLine != null) {
                    currentLine.text = selectedLine;
                    currentLine.moveToEnd();
                    await write(`${prefix}${selectedLine}`);
                } else {
                    currentLine.reset();
                    await write(prefix);
                }
                matched = ANSI_CURSOR_UP.length;
            } else if (received.startsWith(ANSI_CURSOR_DOWN)) {
                echo = false;
                const selectedLine = history.onCursorUp();
                const prefix = `${ANSI_ERASE_ENTIRE_LINE}${ASCII_CARRIAGE_RETURN}${PROMPT}`;
                if (selectedLine != null) {
                    currentLine.text = selectedLine;
                    currentLine.moveToEnd();
                    await write(`${prefix}${selectedLine}`);
                } else {
                    currentLine.reset();
                    await write(prefix);
                }
                matched = ANSI_CURSOR_DOWN.length;
            } else {
                currentLine.insert(received[0]);
                matched = 1;
            } 
            if (echo) {
                await write(received.slice(0, matched));
            }
            received = received.slice(matched);
        }
        
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
            await writeln(`<${error.message}>`);
            return;
        }
    }

    const {builtin, pipeline} = parsed;

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
                stdout = shellStdout;
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

            // Once a stream has been duplicated in the child, we should close our version, to ensure
            // correct pipe behaviour when the child closes their version.
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
        for (let line of [
            "Example commands:", 
            "-------------------",
            "editor:            text editor", 
            "sudoku:            mouse-based game", 
            "time:              show current time",
            "textcolor <color>: change text color",
            "bgcolor <color>:   change background color"
        ]) {
            await writeln(line);
        }
    },

    textcolor: async function(args) {
        if (args.length >= 1) {
            await stdlib.terminal.setTextStyle(args[0]);
        } else {
            await writeln("<missing color argument>");
        }
    },

    bgcolor: async function(args) {
        if (args.length >= 1) {
            await stdlib.terminal.setBackgroundStyle(args[0]);
        } else {
            await writeln("<missing color argument>");
        }
    },

    clear: async function(args) {
        await stdlib.terminal.clear();
    },

    kill: async function(args) {
        if (args.length >= 1) {
            const pid = args[0];
            try {
                await syscall("sendSignal", {signal: "kill", pid});
            } catch (e) {
                await writeln("<" + e.message + ">");
            }
        } else {
            await writeln("<missing pid argument>");
        }
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
            await syscall("waitForExit", pid);
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

    if (pipeline != null && builtin != null) {
        throw new ParseError("builtins are not supported in pipeline");
    }

    return {pipeline, builtin};
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