import { Directory, TextFile, BrowserConsoleFile, NullFile, PipeFile } from "./io.mjs";
import { System } from "./system.mjs";

async function bootSystem() {

    const programs = [
        "cat",
        "countdown",
        "crash",
        "diagnose",
        "demo",
        "echo",
        "editor", 
        "debug",
        "fibonacci",
        "filepicker2",
        "inspect",
        "js",
        "json",
        "kill",
        "launcher2",
        "less",
        "lines",
        "ls", 
        "plot", 
        "ps", 
        "remoteshell",
        "shell", 
        "snake", 
        "sudoku", 
        "taskman",
        "terminal", 
        "test", 
        "top",
        "time", 
    ];
    
    const rootDir = new Directory();

    const binDir = new Directory();
    rootDir.createDirEntry("bin", binDir);

    async function createProgramFile(name, dir) {
        const text = await fetchProgram(name);    
        dir.createDirEntry(name, new TextFile(text));
    }

    for (let program of programs) {
        await createProgramFile(program, binDir);
    }

    const sysDir = new Directory();
    rootDir.createDirEntry("sys", sysDir);
    await createProgramFile("init", sysDir);

    const devDir = new Directory();
    rootDir.createDirEntry("dev", devDir);
    devDir.createDirEntry("con", new BrowserConsoleFile());
    devDir.createDirEntry("null", new NullFile());
    devDir.createDirEntry("pipe", new PipeFile());

    binDir.createDirEntry("empty", new TextFile("<script>\nfunction main() {}\n"));
    binDir.createDirEntry("log", new TextFile( "<script>\nasync function main(args) { console.log(args); }\n"));

    const customFiles = [
        ["textfile", new TextFile("hello world\nthis is the second line. it is longer. it may even be long enough to have to break.\n and here is the third line after a white space.")],
        ["short", new TextFile("hello world")],
        ["config.json", new TextFile('{"prompt": "~ "}\n')],
    ];

    for (const [name, file] of customFiles) {
        rootDir.createDirEntry(name, file);
    }

    const subdir = new Directory();
    subdir.createDirEntry("x", new TextFile("this file lives in a subdir"));
    subdir.createDirEntry("inner", new Directory());
    rootDir.createDirEntry("subdir", subdir);

    const system = new System(rootDir);
    await system.initWindowManager()
    await system.initPseudoTerminalSystem();
    
    await system._spawnProcess({programPath: "/sys/init", args: [], fds: {}, parent: null, pgid: "START_NEW", sid: "START_NEW", workingDirectory: "/"});

    return system;
}

async function fetchProgram(programName) {
    const response = await fetch("programs/" + programName + ".js", {});
    let code = await response.text();
    code = "<script>\n" + code;
    return code;
}

// To enable debugging in the browser console
window["sys"] = await bootSystem();