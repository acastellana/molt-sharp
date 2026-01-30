/**
 * Sharp Dashboard - WebSocket Connection Management
 */

import { state } from './state.js';

// Constants
const WS_PROTOCOL_VERSION = 3;
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];

// Callbacks set by app.js
let onConnected = () => {};
let onAuthError = () => {};
let onChatEvent = () => {};
let onAgentEvent = () => {};

export function setCallbacks(callbacks) {
  if (callbacks.onConnected) onConnected = callbacks.onConnected;
  if (callbacks.onAuthError) onAuthError = callbacks.onAuthError;
  if (callbacks.onChatEvent) onChatEvent = callbacks.onChatEvent;
  if (callbacks.onAgentEvent) onAgentEvent = callbacks.onAgentEvent;
}

export function connectWebSocket() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  
  state.connectNonce = null;
  state.connectSent = false;
  setConnectionStatus('connecting');
  
  // Build WebSocket URL - use /ws path for Caddy proxy
  let wsUrl = state.gatewayUrl.replace(/^http/, 'ws');
  if (!wsUrl.includes(':18789')) {
    wsUrl = wsUrl.replace(/\/?$/, '/ws');
  }
  console.log('[WS] Connecting to', wsUrl);
  
  try {
    state.ws = new WebSocket(wsUrl);
  } catch (err) {
    console.error('[WS] Failed to create WebSocket:', err);
    setConnectionStatus('error');
    scheduleReconnect();
    return;
  }
  
  state.ws.onopen = () => {
    console.log('[WS] Socket opened, waiting for challenge...');
    state.wsLastMessageAt = Date.now();
  };
  
  state.ws.onmessage = (event) => {
    state.wsLastMessageAt = Date.now();
    resetStaleTimer();
    
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (err) {
      console.error('[WS] Parse error:', err);
    }
  };
  
  state.ws.onerror = (err) => {
    console.error('[WS] Error:', err);
  };
  
  state.ws.onclose = (event) => {
    console.log('[WS] Closed:', event.code, event.reason);
    state.connected = false;
    state.ws = null;
    state.connectNonce = null;
    state.connectSent = false;
    clearWsTimers();
    setConnectionStatus('error');
    
    for (const [id, pending] of state.rpcPending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('WebSocket closed'));
    }
    state.rpcPending.clear();
    
    scheduleReconnect();
  };
}

function handleWsMessage(msg) {
  if (msg.type === 'event') {
    console.log('[Sharp] WS Event:', msg.event, msg.payload ? JSON.stringify(msg.payload).slice(0, 200) : '');
  }
  
  // Challenge for auth
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    state.connectNonce = msg.payload?.nonce;
    sendConnect();
    return;
  }
  
  // RPC response
  if (msg.type === 'res' && msg.id) {
    const pending = state.rpcPending.get(msg.id);
    if (pending) {
      state.rpcPending.delete(msg.id);
      clearTimeout(pending.timeout);
      
      if (msg.error) {
        pending.reject(new Error(msg.error?.message || 'RPC failed'));
      } else {
        pending.resolve(msg.payload ?? msg.result);
      }
    }
    return;
  }
  
  // Chat events (streaming)
  if (msg.type === 'event' && msg.event === 'chat') {
    onChatEvent(msg.payload);
    return;
  }
  
  // Agent lifecycle events
  if (msg.type === 'event' && msg.event === 'agent') {
    onAgentEvent(msg.payload);
    return;
  }
}

function sendConnect() {
  if (state.connectSent || !state.ws) return;
  state.connectSent = true;
  
  const connectId = String(++state.rpcIdCounter);
  
  const connectParams = {
    minProtocol: WS_PROTOCOL_VERSION,
    maxProtocol: WS_PROTOCOL_VERSION,
    client: {
      id: 'clawdbot-control-ui',
      displayName: 'Sharp Dashboard',
      mode: 'ui',
      version: '2.0.0',
      platform: 'browser'
    }
  };
  
  if (state.token) {
    connectParams.auth = { password: state.token };
  }
  
  const connectFrame = {
    type: 'req',
    id: connectId,
    method: 'connect',
    params: connectParams
  };
  
  console.log('[WS] Sending connect request');
  state.ws.send(JSON.stringify(connectFrame));
  
  const timeout = setTimeout(() => {
    state.rpcPending.delete(connectId);
    console.error('[WS] Connect timeout');
    state.ws?.close(1008, 'connect timeout');
  }, 10000);
  
  state.rpcPending.set(connectId, {
    resolve: (result) => {
      console.log('[WS] Connected successfully');
      state.connected = true;
      state.wsReconnectAttempts = 0;
      setConnectionStatus('connected');
      hideReconnectOverlay();
      localStorage.setItem('sharp_token', state.token);
      localStorage.setItem('sharp_gateway', state.gatewayUrl);
      startKeepalive();
      onConnected();
    },
    reject: (err) => {
      console.error('[WS] Connect failed:', err);
      state.connectSent = false;
      setConnectionStatus('error');
      onAuthError(err);
    },
    timeout
  });
}

// RPC Call
export function rpcCall(method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!state.connected || !state.ws) {
      reject(new Error('WebSocket not connected'));
      return;
    }
    
    const id = String(++state.rpcIdCounter);
    const frame = { type: 'req', id, method, params };
    
    const timeout = setTimeout(() => {
      state.rpcPending.delete(id);
      reject(new Error('RPC timeout'));
    }, timeoutMs);
    
    state.rpcPending.set(id, { resolve, reject, timeout });
    state.ws.send(JSON.stringify(frame));
  });
}

// Timer Management
export function clearWsTimers() {
  if (state.wsReconnectTimer) {
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }
  if (state.wsKeepaliveTimer) {
    clearInterval(state.wsKeepaliveTimer);
    state.wsKeepaliveTimer = null;
  }
  if (state.wsStaleTimer) {
    clearTimeout(state.wsStaleTimer);
    state.wsStaleTimer = null;
  }
}

function scheduleReconnect() {
  if (state.wsReconnectTimer) return;
  
  const delay = RECONNECT_DELAYS[Math.min(state.wsReconnectAttempts, RECONNECT_DELAYS.length - 1)];
  state.wsReconnectAttempts++;
  
  showReconnectOverlay(state.wsReconnectAttempts);
  
  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${state.wsReconnectAttempts})`);
  state.wsReconnectTimer = setTimeout(() => {
    state.wsReconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function showReconnectOverlay(attempt) {
  const overlay = document.getElementById('reconnectOverlay');
  const attemptEl = document.getElementById('reconnectAttempt');
  if (overlay) {
    overlay.classList.add('visible');
    if (attemptEl) attemptEl.textContent = `Attempt ${attempt}`;
  }
}

function hideReconnectOverlay() {
  const overlay = document.getElementById('reconnectOverlay');
  if (overlay) overlay.classList.remove('visible');
}

function startKeepalive() {
  if (state.wsKeepaliveTimer) clearInterval(state.wsKeepaliveTimer);
  
  state.wsKeepaliveTimer = setInterval(() => {
    if (state.connected && state.ws) {
      state.ws.send(JSON.stringify({ type: 'req', id: 'keepalive', method: 'status', params: {} }));
    }
  }, 25000);
}

function resetStaleTimer() {
  if (state.wsStaleTimer) clearTimeout(state.wsStaleTimer);
  
  state.wsStaleTimer = setTimeout(() => {
    const sinceLastMessage = Date.now() - state.wsLastMessageAt;
    if (sinceLastMessage > 60000) {
      console.log('[WS] Connection stale, reconnecting...');
      state.ws?.close(1000, 'stale');
    }
  }, 65000);
}

// Connection Status UI
export function setConnectionStatus(status) {
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');
  if (!dot || !text) return;
  
  switch (status) {
    case 'connected':
      dot.style.background = 'var(--green)';
      text.textContent = 'Connected';
      for (const key of Object.keys(state.sessionStatus)) {
        if (state.sessionStatus[key] === 'offline') {
          state.sessionStatus[key] = 'idle';
        }
      }
      break;
    case 'connecting':
      dot.style.background = 'var(--yellow)';
      text.textContent = 'Connecting...';
      break;
    case 'error':
      dot.style.background = 'var(--red)';
      text.textContent = 'Disconnected';
      for (const key of Object.keys(state.sessionStatus)) {
        state.sessionStatus[key] = 'offline';
      }
      break;
  }
}

// Reconnect manually
export function reconnect() {
  if (state.token && state.gatewayUrl) {
    sendConnect();
  } else {
    connectWebSocket();
  }
}
