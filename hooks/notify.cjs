#!/usr/bin/env node

const http = require('http');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf-8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  let payload = {};
  try {
    if (input && input.trim()) {
      payload = JSON.parse(input);
    }
  } catch (e) {
    // Ignore invalid JSON
  }

  const event = process.argv[2] || 'unknown';
  const workspacePath = payload.workspacePaths && payload.workspacePaths.length > 0 ? payload.workspacePaths[0] : null;
  const sessionName = process.env.AGY_SESSION_NAME || process.env.TMUX_SESSION_NAME || (workspacePath ? path.basename(workspacePath) : null);

  const postData = JSON.stringify({
    event,
    session: sessionName,
    conversationId: payload.conversationId,
    workspacePath,
    toolCall: payload.toolCall ? payload.toolCall.name : null
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port: 8080,
    path: '/api/hook/notify',
    method: 'POST',
    timeout: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    // Consume response to free socket
    res.resume();
    res.on('end', () => {
      process.stdout.write('{}');
      process.exit(0);
    });
  });

  req.on('error', () => {
    // Graceful fallback when server is not running
    process.stdout.write('{}');
    process.exit(0);
  });

  req.on('timeout', () => {
    req.destroy();
    process.stdout.write('{}');
    process.exit(0);
  });

  req.write(postData);
  req.end();
});
