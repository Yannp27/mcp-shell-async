#!/usr/bin/env node
/**
 * MCP Shell - Async cmd.exe with polling support
 * Agents can start commands, poll for output, and kill if needed
 */

const { spawn } = require('child_process');
const readline = require('readline');

const BLACKLISTED = ['rm', 'rmdir', 'del', 'format', 'mkfs', 'dd', 'chmod', 'chown', 'sudo', 'su', 'shutdown', 'reboot'];

// Active jobs store
const jobs = new Map();
let jobCounter = 0;

function validateCommand(cmd) {
    const base = cmd.trim().split(/\s+/)[0].toLowerCase();
    if (base === 'cmd') {
        const m = cmd.match(/cmd\s+\/c\s+["']?(\w+)/i);
        if (m) return !BLACKLISTED.includes(m[1].toLowerCase());
    }
    return !BLACKLISTED.includes(base);
}

function createJob(command) {
    const id = `job_${++jobCounter}_${Date.now()}`;
    const isWindows = process.platform === 'win32';

    const job = {
        id,
        command,
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
        startTime: Date.now(),
        lastOutputTime: Date.now(),
        outputLines: 0,
        proc: null
    };

    // Spawn the process
    if (isWindows) {
        job.proc = spawn('cmd', ['/c', command], {
            windowsHide: true,
            env: process.env
        });
    } else {
        job.proc = spawn('/bin/bash', ['-c', command], {
            env: process.env
        });
    }

    job.proc.stdout.on('data', (data) => {
        const text = data.toString();
        job.stdout += text;
        job.lastOutputTime = Date.now();
        job.outputLines += text.split('\n').length - 1;
    });

    job.proc.stderr.on('data', (data) => {
        const text = data.toString();
        job.stderr += text;
        job.lastOutputTime = Date.now();
    });

    job.proc.on('close', (code) => {
        job.status = 'done';
        job.exitCode = code;
        job.proc = null;
    });

    job.proc.on('error', (err) => {
        job.status = 'error';
        job.stderr += `\nProcess error: ${err.message}`;
        job.proc = null;
    });

    jobs.set(id, job);
    return id;
}

function pollJob(id, fromLine = 0) {
    const job = jobs.get(id);
    if (!job) return { error: `Job not found: ${id}` };

    const lines = job.stdout.split('\n');
    const newOutput = lines.slice(fromLine).join('\n');
    const elapsed = Date.now() - job.startTime;
    const idleTime = Date.now() - job.lastOutputTime;

    return {
        id: job.id,
        status: job.status,
        exitCode: job.exitCode,
        elapsedMs: elapsed,
        idleSinceMs: idleTime,
        totalLines: lines.length,
        fromLine: fromLine,
        output: newOutput,
        stderr: job.stderr,
        isStalled: idleTime > 30000 && job.status === 'running' // 30s no output = stalled
    };
}

function killJob(id) {
    const job = jobs.get(id);
    if (!job) return { error: `Job not found: ${id}` };

    if (job.proc) {
        job.proc.kill('SIGTERM');
        setTimeout(() => {
            if (job.proc) job.proc.kill('SIGKILL');
        }, 1000);
    }

    job.status = 'killed';
    return { success: true, id };
}

function listJobs() {
    const result = [];
    for (const [id, job] of jobs) {
        result.push({
            id,
            command: job.command.substring(0, 100),
            status: job.status,
            elapsedMs: Date.now() - job.startTime,
            outputLines: job.outputLines
        });
    }
    return result;
}

function cleanupJob(id) {
    const job = jobs.get(id);
    if (job && job.status !== 'running') {
        jobs.delete(id);
        return { success: true };
    }
    return { error: 'Job still running or not found' };
}

function handleRequest(req) {
    try {
        const parsed = JSON.parse(req);
        const { id, method, params } = parsed;

        if (method === 'initialize') {
            return {
                jsonrpc: '2.0', id, result: {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'shell-cmd-async', version: '2.0.0' },
                    capabilities: { tools: {} }
                }
            };
        }

        if (method === 'tools/list') {
            return {
                jsonrpc: '2.0', id, result: {
                    tools: [
                        {
                            name: 'start_command',
                            description: 'Start a command asynchronously. Returns job ID for polling.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    command: { type: 'string', description: 'Command to execute via cmd.exe' }
                                },
                                required: ['command']
                            }
                        },
                        {
                            name: 'poll_command',
                            description: 'Poll a running command for output and status. Check isStalled to detect frozen commands.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    job_id: { type: 'string', description: 'Job ID from start_command' },
                                    from_line: { type: 'number', description: 'Get output from this line (default: 0)' }
                                },
                                required: ['job_id']
                            }
                        },
                        {
                            name: 'kill_command',
                            description: 'Kill a running command. Use if isStalled=true or command needs to be terminated.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    job_id: { type: 'string', description: 'Job ID to kill' }
                                },
                                required: ['job_id']
                            }
                        },
                        {
                            name: 'list_jobs',
                            description: 'List all active and recent jobs.',
                            inputSchema: { type: 'object', properties: {} }
                        },
                        {
                            name: 'run_command',
                            description: 'Run a command synchronously (for quick commands). Timeout: 60s.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    command: { type: 'string', description: 'Command to execute' }
                                },
                                required: ['command']
                            }
                        }
                    ]
                }
            };
        }

        if (method === 'tools/call') {
            const toolName = params?.name;
            const args = params?.arguments || {};

            if (toolName === 'start_command') {
                if (!validateCommand(args.command)) {
                    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: Command blacklisted' }] } };
                }
                const jobId = createJob(args.command);
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ job_id: jobId, status: 'started' }) }] } };
            }

            if (toolName === 'poll_command') {
                const result = pollJob(args.job_id, args.from_line || 0);
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
            }

            if (toolName === 'kill_command') {
                const result = killJob(args.job_id);
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } };
            }

            if (toolName === 'list_jobs') {
                const result = listJobs();
                return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } };
            }

            if (toolName === 'run_command') {
                // Sync execution for quick commands
                if (!validateCommand(args.command)) {
                    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Error: Command blacklisted' }] } };
                }
                try {
                    const { execSync } = require('child_process');
                    const isWindows = process.platform === 'win32';
                    const escaped = args.command.replace(/"/g, '\\"');
                    const result = isWindows
                        ? execSync(`cmd /c "${escaped}"`, { encoding: 'utf8', timeout: 60000, windowsHide: true })
                        : execSync(args.command, { encoding: 'utf8', shell: '/bin/bash', timeout: 60000 });
                    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result || '(no output)' }] } };
                } catch (err) {
                    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.stderr || err.message}` }] } };
                }
            }

            return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
        }

        if (method === 'notifications/initialized') {
            return null;
        }

        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
    } catch (e) {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${e.message}` } };
    }
}

// stdio transport
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', (line) => {
    if (!line.trim()) return;
    const response = handleRequest(line);
    if (response) {
        console.log(JSON.stringify(response));
    }
});

// Cleanup old completed jobs every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (job.status !== 'running' && now - job.startTime > 300000) {
            jobs.delete(id);
        }
    }
}, 60000);

console.error('MCP shell (async cmd.exe) running on stdio');
console.error('Tools: start_command, poll_command, kill_command, list_jobs, run_command');
