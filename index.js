const express = require('express');
const axios = require('axios');
const configFile = require('./config.json'); // Import the config file
const path = require('path');

// Initialize Express app
const app = express();
const port = configFile.port;

// Store logs temporarily
let logs = [];

// Middleware to serve static files (for frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to parse JSON requests
app.use(express.json());

// Log message capturing function
function captureLog(message) {
    const logMessage = { timestamp: new Date().toISOString(), message };
    logs.push(logMessage); // Store logs
}

// Function to suspend a server
async function suspendServer(id) {
    try {
        const baseUrl = configFile.hydra.url;
        if (!baseUrl) {
            captureLog('Base URL is missing in the config');
            return;
        }

        const url = `${baseUrl}/api/instances/suspend?key=${configFile.hydra.key}&id=${id}`;
        const response = await axios.get(url);

        if (response.status === 200) {
            captureLog(`Server with ID: ${id} has been suspended successfully.`);
        } else {
            captureLog(`Failed to suspend server with ID: ${id}. Status: ${response.status}`);
        }
    } catch (error) {
        captureLog(`Error suspending server with ID: ${id}: ${error.message}`);
    }
}

// Function to get all instances
async function getInstances() {
    try {
        const baseUrl = configFile.hydra.url;
        if (!baseUrl) {
            captureLog('Base URL is missing in the config');
            return [];
        }

        const url = `${baseUrl}/api/instances?key=${configFile.hydra.key}`;
        const response = await axios.get(url);

        if (response.status === 200) {
            if (response.data) {
                const activeInstances = response.data.filter(instance => !instance.suspended);
                return activeInstances;
            } else {
                captureLog('No data received in response');
                return [];
            }
        } else {
            captureLog(`Failed to retrieve instances. Status: ${response.status}`);
            return [];
        }
    } catch (error) {
        captureLog(`Error retrieving instances: ${error.message}`);
        return [];
    }
}

// Function to get files from a specific instance
async function getInstanceFiles(id, path) {
    try {
        const baseUrl = configFile.node.url;
        if (!baseUrl) {
            captureLog('Base URL is missing in the config');
            return [];
        }

        const url = `${baseUrl}/fs/${id}/files?path=${path}`;
        const response = await axios.get(url, {
            auth: {
                username: 'Skyport',
                password: configFile.node.key,
            },
        });

        if (response.status === 200) {
            const files = response.data.files;
            if (Array.isArray(files)) {
                for (const file of files) {
                    captureLog(`File: ${file.name} Extension: ${file.extension} Purpose: ${file.purpose}`);
                    if (file.isDirectory && !file.isEditable) {
                        await getInstanceFiles(id, file.name);
                    }
                    if (file.purpose === 'script') {
                        await suspendServer(id);
                        captureLog(`Suspicious .sh file detected in server: ${id}`);
                    }
                    if (file.name === 'xmrig') {
                        await suspendServer(id);
                        captureLog(`Suspicious mining activity detected in server: ${id}`);
                    }
                    if (file.name === 'server.jar') {
                        let sizeInBytes;
                        if (file.size.includes('MB')) {
                            sizeInBytes = parseFloat(file.size) * 1024 * 1024;
                        } else if (file.size.includes('KB')) {
                            sizeInBytes = parseFloat(file.size) * 1024;
                        } else if (file.size.includes('B')) {
                            sizeInBytes = parseFloat(file.size);
                        } else {
                            captureLog(`Unknown size format: ${file.size}`);
                            return;
                        }

                        if (sizeInBytes < 18 * 1024 * 1024) {
                            await suspendServer(id);
                            captureLog(`Suspicious server.jar file size detected: ${id}`);
                        }
                    }
                    if (file.isEditable) {
                        continue;
                    }
                }
            } else {
                captureLog('Files field is missing or not an array.');
            }
        } else {
            captureLog(`Failed to retrieve files for instance with ID: ${id} at path: ${path}. Status: ${response.status}`);
        }
    } catch (error) {
        captureLog(`Error retrieving files for instance with ID: ${id} at path: ${path}: ${error.message}`);
    }
}

// Function to fetch all instances and process them
async function processAllInstances() {
    try {
        const instances = await getInstances();

        for (const instance of instances) {
            const id = instance.Id;
            captureLog(`Processing instance with ID: ${id}`);
            await getInstanceFiles(id, '');
        }
    } catch (error) {
        captureLog(`Error processing instances: ${error.message}`);
    }
}

// Endpoint to trigger the scan and process all instances
app.get('/scan', async (req, res) => {
    logs = []; // Clear previous logs
    try {
        await processAllInstances();
        res.status(200).json({ message: 'Scan completed successfully', logs });
    } catch (error) {
        res.status(500).json({ message: 'Error in scan process', error: error.message });
    }
});

// Endpoint to get the logs
app.get('/logs', (req, res) => {
    res.status(200).json({ logs });
});

// Serve index.html for frontend
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Real-time Logs</title>
            <script src="https://cdn.jsdelivr.net/npm/xterm@4.12.0/lib/xterm.js"></script>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@4.12.0/css/xterm.css" />
        </head>
        <body>
            <button id="startScan">Start Scan</button>
            <div id="terminal" class="bg-black/20 p-4 rounded-xl border border-white/5 shadow-sm scrollbar-hide overflow-x-auto mb-4"></div>

            <script>
                const baseTheme = {
            foreground: '#c5c9d1',
            background: 'rgba(0 0 0 / 0)',
            selection: '#5DA5D533',
            black: '#1E1E1D',
            brightBlack: '#262625',
            red: '#E54B4B',
            green: '#9ECE58',
            yellow: '#FAED70',
            blue: '#396FE2',
            magenta: '#BB80B3',
            cyan: '#2DDAFD',
            white: '#d0d0d0',
            brightBlack: 'rgba(255, 255, 255, 0.2)',
            brightRed: '#FF5370',
            brightGreen: '#C3E88D',
            brightYellow: '#FFCB6B',
            brightBlue: '#82AAFF',
            brightMagenta: '#C792EA',
            brightCyan: '#89DDFF',
            brightWhite: '#ffffff',
        };

                const terminal = new Terminal({
                    disableStdin: true,
                    allowProposedApi: true,
                    cursorStyle: 'underline',
                    rows: 20,
                    cols: 100,
                    fontFamily: 'Menlo, monospace',
                    theme: baseTheme,
                    allowTransparency: true,
                    fontSize: 12,
                    lineHeight: 1.0, // Standard line height
                });

                terminal.open(document.getElementById('terminal'));

                document.getElementById('startScan').addEventListener('click', async () => {
                    await fetch('/scan'); // Trigger the scan when the button is clicked
                    fetchLogs(); // Fetch and display logs after the scan starts
                });

                // Function to fetch logs from the backend and update the terminal
                async function fetchLogs() {
                    const response = await fetch('/logs');
                    const data = await response.json();
                    data.logs.forEach(log => {
                        terminal.writeln(`[${log.timestamp}] ${log.message}`); // Display logs in xterm.js
                    });
                }

                // Optional: WebSocket for real-time log updates
                const socket = new WebSocket('ws://localhost:3000');
                socket.onmessage = function(event) {
                    const log = JSON.parse(event.data); // Parse the JSON message
                    terminal.writeln(`[${log.timestamp}] ${log.message}`); // Display it in xterm.js
                };
                  setInterval(fetchLogs, 1);  // 1ms interval
            </script>
        </body>
        </html>
    `);
});

// Start the Express server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
