"use strict";


const STDOUT = 1;
const COMMAND_STREAM = 2;

async function printPrompt() {
    await writeln(JSON.stringify({printPrompt: null}), COMMAND_STREAM);
}

async function setTextStyle(style) {
    await writeln(JSON.stringify({setTextStyle: style}), COMMAND_STREAM);
}

async function setBackgroundStyle(style) {
    await writeln(JSON.stringify({setBackgroundStyle: style}), COMMAND_STREAM);
}

let backgroundedPids = [];

async function main(args) {

    // The shell shouldn't be killed by ctrl-C when in the foreground
    await syscall("ignoreInterruptSignal");

    await setTextStyle("#0F0");
    await setBackgroundStyle("black");

    await writeln("[WELCOME TO THE SHELL]");

    while (true) {
        await printPrompt();

        const input = await readln();

        const words = input.split(' ').filter(w => w !== '');

        if (words.length == 0) {
            continue;
        }
        
        const command = words[0];
        if (command == "help") {
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
        }  else if (command == "textcolor") {
            if (words.length >= 2) {
                await setTextStyle(words[1]);
            } else {
                await writeln("<missing color argument>");
            }
        } else if (command == "bgcolor") {
            if (words.length >= 2) {
                await setBackgroundStyle(words[1]);
            } else {
                await writeln("<missing color argument>");
            }
        } else if (command == "ps") {
            const procs = await syscall("listProcesses");
            if (procs.length > 0) {
                await writeln("pgid  ppid  pid  program")
                for (let proc of procs) {
                    const ppid = proc.ppid != null? proc.ppid : " ";
                    await writeln(proc.pgid + "     " + ppid + "     " + proc.pid + "    " + proc.programName)
                }
            } else {
                await writeln("<no running processes>");
            }
        } else if (command == "kill") {
            if (words.length >= 2) {
                const pid = words[1];
                try {
                    await syscall("sendSignal", {signal: "kill", pid});
                } catch (e) {
                    await writeln("<" + e.message + ">");
                }
            } else {
                await writeln("<missing pid argument>");
            }
        } else if (command == "fg") {
            const pid = backgroundedPids.shift();
            if (pid != undefined) {
                await writeln(`[${pid}]`)
            }
            
        } else {
            const fileNames = await syscall("listFiles");

            if (fileNames.indexOf(command) >= 0) {
                
                const runInBackground = words.slice(-1)[0] == "&";
                let args;
                if (runInBackground) {
                    args = words.slice(1, -1);
                    console.log("Starting program in background");
                } else {
                    args = words.slice(1);
                }

                let pid;
                try {
                    pid = await syscall("spawn", {program: command, args, startNewProcessGroup: true});
                } catch (e) {
                    await writeln("<" + e.message + ">");
                }

                if (runInBackground) {
                    backgroundedPids.push(pid);
                    console.log("IN BACKGROUND: ", backgroundedPids);
                } else {
                    // Give the terminal to the new foreground group
                    await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: pid});
                    await syscall("waitForExit", pid);
                    // Reclaim the terminal
                    await syscall("setForegroundProcessGroupOfPseudoTerminal", {toSelf: true});
                }
            } else {
                await writeln(`Unknown command (${command}). Try typing: help`);
            }
    
        }
   
    }
}
