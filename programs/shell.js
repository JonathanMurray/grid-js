"use strict";


const STDOUT = 1;
const COMMAND_STREAM = 2;

async function printPrompt() {
    await syscall("write", {output: [JSON.stringify({printPrompt: null})], streamId: COMMAND_STREAM});
}

async function setTextStyle(style) {
    await syscall("write", {output: [JSON.stringify({setTextStyle: style})], streamId: COMMAND_STREAM});
}

async function setBackgroundStyle(style) {
    await syscall("write", {output: [JSON.stringify({setBackgroundStyle: style})], streamId: COMMAND_STREAM});
}

async function main(args) {

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
            await syscall("write", {output:[
                "Example commands:", 
                "-------------------",
                "editor:     text editor", 
                "sudoku:     mouse-based game", 
                "time:       show current time",
                "fg <color>: change terminal text color",
                "bg <color>: change terminal background color"
            ], streamId:STDOUT});
        }  else if (command == "fg") {
            if (words.length >= 2) {
                await setTextStyle(words[1]);
            } else {
                await writeln("<missing color argument>");
            }
        } else if (command == "bg") {
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

                const shellPid = 0;
                let pid;
                try {
                    pid = await syscall("spawn", {program: command, args, detached: runInBackground}, args);
                } catch (e) {
                    await writeln("<" + e.message + ">");
                }

                if (!runInBackground) {
                    console.log("WAITING FOR: ", pid);
                    await syscall("waitForExit", pid);
                    console.log("DONE WAITING FOR: ", pid);
                }
            } else {
                await writeln("Unknown command. Try typing: help");
            }
    
        }
   
    }
}
