const net = require('net');
const { randomUUID } = require('crypto');

// Discord IPC opcodes
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

// VoiceScope Discord Application client_id
// Register at https://discord.com/developers/applications
// This is a public identifier, not a secret.
let CLIENT_ID = '1489294877731590184';

let socket = null;
let connected = false;
let inVoice = false;
let lastVoiceChannel = null;

/**
 * Encode an IPC message: [opcode:u32LE][length:u32LE][json payload]
 */
function encode(opcode, data) {
  const json = JSON.stringify(data);
  const len = Buffer.byteLength(json);
  const buf = Buffer.alloc(8 + len);
  buf.writeUInt32LE(opcode, 0);
  buf.writeUInt32LE(len, 4);
  buf.write(json, 8);
  return buf;
}

/**
 * Decode one IPC message from a buffer.
 * Returns { opcode, data, rest } or null if incomplete.
 */
function decode(buf) {
  if (buf.length < 8) return null;
  const opcode = buf.readUInt32LE(0);
  const len = buf.readUInt32LE(4);
  if (buf.length < 8 + len) return null;
  const json = buf.slice(8, 8 + len).toString();
  let data;
  try { data = JSON.parse(json); } catch { data = {}; }
  return { opcode, data, rest: buf.slice(8 + len) };
}

/**
 * Find and connect to Discord's IPC named pipe.
 */
function connect(clientId) {
  if (clientId) CLIENT_ID = clientId;

  return new Promise((resolve) => {
    // Try pipe indexes 0-9
    let pipeIndex = 0;
    const tryConnect = () => {
      if (pipeIndex > 9) {
        resolve(false);
        return;
      }
      const pipePath = `\\\\?\\pipe\\discord-ipc-${pipeIndex}`;
      const s = net.createConnection(pipePath);
      let buf = Buffer.alloc(0);
      let handshakeDone = false;

      s.on('connect', () => {
        // Send handshake
        s.write(encode(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID }));
      });

      s.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        let msg;
        while ((msg = decode(buf)) !== null) {
          buf = msg.rest;
          if (msg.opcode === OP_FRAME && msg.data.cmd === 'DISPATCH' && msg.data.evt === 'READY') {
            handshakeDone = true;
            socket = s;
            connected = true;
            console.log('[DiscordRPC] Connected to Discord IPC');
            resolve(true);
          } else if (msg.opcode === OP_CLOSE) {
            s.destroy();
            resolve(false);
            return;
          } else if (msg.opcode === OP_FRAME) {
            handleFrame(msg.data);
          }
        }
      });

      s.on('error', () => {
        pipeIndex++;
        tryConnect();
      });

      s.on('close', () => {
        if (socket === s) {
          socket = null;
          connected = false;
          inVoice = false;
          lastVoiceChannel = null;
          console.log('[DiscordRPC] Disconnected');
        }
      });

      // Timeout per attempt
      setTimeout(() => {
        if (!handshakeDone) {
          s.destroy();
          pipeIndex++;
          tryConnect();
        }
      }, 2000);
    };
    tryConnect();
  });
}

/**
 * Handle incoming frames from Discord.
 */
function handleFrame(data) {
  if (data.cmd === 'GET_SELECTED_VOICE_CHANNEL') {
    if (data.data && data.data.id) {
      inVoice = true;
      lastVoiceChannel = data.data.name || data.data.id;
    } else {
      inVoice = false;
      lastVoiceChannel = null;
    }
  }
}

/**
 * Query the currently selected voice channel.
 * Returns a Promise<boolean> — true if user is in a voice channel.
 */
function checkVoiceChannel() {
  return new Promise((resolve) => {
    if (!socket || !connected) {
      inVoice = false;
      resolve(false);
      return;
    }

    const nonce = randomUUID();
    let buf = Buffer.alloc(0);
    let responded = false;

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let msg;
      while ((msg = decode(buf)) !== null) {
        buf = msg.rest;
        if (msg.opcode === OP_FRAME && msg.data.nonce === nonce) {
          responded = true;
          socket.removeListener('data', onData);
          if (msg.data.data && msg.data.data.id) {
            inVoice = true;
            lastVoiceChannel = msg.data.data.name || msg.data.data.id;
          } else {
            inVoice = false;
            lastVoiceChannel = null;
          }
          resolve(inVoice);
        }
      }
    };

    socket.on('data', onData);
    socket.write(encode(OP_FRAME, {
      cmd: 'GET_SELECTED_VOICE_CHANNEL',
      args: {},
      nonce,
    }));

    // Timeout
    setTimeout(() => {
      if (!responded) {
        socket.removeListener('data', onData);
        resolve(false);
      }
    }, 3000);
  });
}

function disconnect() {
  if (socket) {
    try { socket.write(encode(OP_CLOSE, {})); } catch {}
    socket.destroy();
    socket = null;
  }
  connected = false;
  inVoice = false;
  lastVoiceChannel = null;
}

function isConnected() { return connected; }
function isInVoice() { return inVoice; }
function getVoiceChannel() { return lastVoiceChannel; }

module.exports = { connect, disconnect, checkVoiceChannel, isConnected, isInVoice, getVoiceChannel };
