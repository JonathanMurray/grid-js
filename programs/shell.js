"use strict";

async function printPrompt() {
    await syscalls.controlTerminal({printPrompt: null});
}

async function setTextStyle(style) {
    await syscalls.controlTerminal({setTextStyle: style});
}

async function setBackgroundStyle(style) {
    await syscalls.controlTerminal({setBackgroundStyle: style});
}

async function main(args) {

    await syscalls.write([""]);
    await syscalls.write(["[WELCOME TO THE SHELL]"]);

    while (true) {
        await printPrompt();

        const input = await syscalls.read();

        const words = input.split(' ').filter(w => w !== '');

        if (words.length == 0) {
            continue;
        }
        
        const command = words[0];
        if (command == "help") {
            await syscalls.write([
                "Example commands:", 
                "-------------------",
                "editor:     text editor", 
                "sudoku:     mouse-based game", 
                "time:       show current time",
                "fg <color>: change terminal text color",
                "bg <color>: change terminal background color"
            ]);
        }  else if (command == "fg") {
            if (words.length >= 2) {
                await setTextStyle(words[1]);
            } else {
                await syscalls.write(["<missing color argument>"]);
            }
        } else if (command == "bg") {
            if (words.length >= 2) {
                await setBackgroundStyle(words[1]);
            } else {
                await syscalls.write(["<missing color argument>"]);
            }
        } else if (command == "ps") {
            const procs = await syscalls.listProcesses();
            if (procs.length > 0) {
                await syscalls.write(["parent  pid  foreground  program"])
                for (let proc of procs) {
                    const parentPid = proc.parentPid != null? proc.parentPid : " ";
                    console.log(parentPid);
                    const fg = proc.isInForeground ? "*" : " ";
                    await syscalls.write([parentPid + "       " + proc.pid + "    " + fg + "           " + proc.programName])
                }
            } else {
                await syscalls.write(["<no running processes>"]);
            }
        } else if (command == "kill") {
            if (words.length >= 2) {
                const pid = words[1];
                try {
                    await syscalls.kill(pid);
                } catch (e) {
                    await syscalls.write(["<" + e.message + ">"]);
                }
            } else {
                await syscalls.write(["<missing pid argument>"]);
            }
        } else {

            const fileNames = await syscalls.listFiles();

            if (fileNames.indexOf(command) >= 0) {
                
                const runInBackground = words.slice(-1)[0] == "&";
                let args;
                if (runInBackground) {
                    args = words.slice(1, -1);
                    console.log("Starting program in background");
                } else {
                    args = words.slice(1);
                }

                const shellPid = 0;
                let pid;
                try {
                    pid = await syscalls.spawn({program: command, args, detached: runInBackground}, args);
                } catch (e) {
                    await syscalls.write(["<" + e.message + ">"]);
                }

                if (!runInBackground) {
                    console.log("WAITING FOR: ", pid);
                    await syscalls.waitForExit(pid);
                    console.log("DONE WAITING FOR: ", pid);
                }
            } else {
                await syscalls.write(["Unknown command. Try typing: help"]);
            }
    
        }
   
    }
}
