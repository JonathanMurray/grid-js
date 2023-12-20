import {server} from "websocket";
const WebSocketServer = server;
import http from "http";

let port = 8080;
if (process.argv.length > 2) {
    port = Number.parseInt(process.argv[2]);
}

// This program acts as a TTY intermediary between the terminal and the OS running in the browser.
// We need to receive user input one character at a time, and not wait for newline.
process.stdin.setRawMode(true);

const httpServer = http.createServer(function(request, response) {
    console.log('Received request: ', request.url, request.headers);
    response.writeHead(404);
    response.end();
});
httpServer.listen(port, function() {
    console.log(`Listening on port ${port}`);
    console.log("Waiting on browser to initiate WebSocket connection...");
});

const wsServer = new WebSocketServer({
    httpServer,
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
    return origin.startsWith("http://127.0.0.1");
}

let connection;

process.stdin.on("readable", () => {
    let data;
    while (data = process.stdin.read()) {
        const text = String.fromCharCode(...data);
        if (data != null) {
            if (connection != null) {
                connection.sendUTF(text);
            } else {
                if (text == "\u0003") {
                    process.exit();
                } else {
                    console.log("(no connection) ~ discarding: " + text);
                }
            }
        }
    }
});

wsServer.on('request', async function(request) {
    if (!originIsAllowed(request.origin)) {
      request.reject();
      console.log('Connection from origin ' + request.origin + ' rejected.');
      return;
    }

    if (connection != null) {
        request.reject();
        console.log("Connection rejected. We are already handling one client.");
        return;
    }
    
    connection = request.accept('tty-protocol', request.origin);
    console.log("Connection accepted: ", request.origin);

    connection.on('message', function(message) {
        if (message.type === 'utf8') {
            const text = message.utf8Data;
            if (text.length > 0) {
                process.stdout.write(text);
            } else {
                console.log("(EOF) ~ closing connection");
                connection.close();
            }
        } else {
            console.error("Unhandled message type: ", message.type);
        }
    });
    connection.on('close', function(reasonCode, description) {
        console.log("Peer " + connection.remoteAddress + ' disconnected.', reasonCode, description);
        connection = null;
    });
});

