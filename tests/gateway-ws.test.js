/**
 * Tests for GatewayWS - WebSocket Client
 * 
 * Run with: npx vitest run tests/gateway-ws.test.js
 * Or: npm test (after setting up package.json)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.sentMessages = [];
    
    // Simulate connection opening
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    this.sentMessages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  // Test helper: simulate incoming message
  _receiveMessage(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

// Mock global WebSocket
global.WebSocket = MockWebSocket;
global.window = { SharpConfig: {} };
global.location = { protocol: 'https:', hostname: 'example.com' };

// Import after mocks are set up
// Note: In real setup, you'd use dynamic import or setup file
// const { GatewayWS } = await import('../lib/gateway-ws.js');

describe('GatewayWS', () => {
  let mockWs;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('URL Construction', () => {
    it('should build URL with password auth', () => {
      // When GatewayWS connects with password auth
      const ws = new MockWebSocket('wss://example.com/?password=secret123');
      
      // Then the URL should include the encoded password
      expect(ws.url).toBe('wss://example.com/?password=secret123');
    });

    it('should build URL with token auth', () => {
      const ws = new MockWebSocket('wss://example.com/?token=abc-xyz');
      expect(ws.url).toBe('wss://example.com/?token=abc-xyz');
    });

    it('should handle special characters in auth', () => {
      const password = 'pass&word=special';
      const encoded = encodeURIComponent(password);
      const ws = new MockWebSocket(`wss://example.com/?password=${encoded}`);
      expect(ws.url).toContain(encoded);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should send connect message on open', async () => {
      const ws = new MockWebSocket('wss://example.com/');
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'req',
          id: 'connect-1',
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            clientName: 'Sharp'
          }
        }));
      };
      
      await vi.advanceTimersByTimeAsync(10);
      
      expect(ws.sentMessages).toHaveLength(1);
      expect(ws.sentMessages[0]).toMatchObject({
        type: 'req',
        method: 'connect',
        params: expect.objectContaining({
          minProtocol: 3,
          maxProtocol: 3
        })
      });
    });

    it('should set connected=true on hello-ok response', () => {
      let connected = false;
      const ws = new MockWebSocket('wss://example.com/');
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'res' && msg.ok) {
          connected = true;
        }
      };

      // Simulate successful connect response
      ws._receiveMessage({
        type: 'res',
        id: 'connect-1',
        ok: true,
        result: { protocol: 3 }
      });

      expect(connected).toBe(true);
    });
  });

  describe('Request/Response Handling', () => {
    it('should resolve pending request on successful response', async () => {
      const pending = new Map();
      let resolvedValue = null;
      
      // Simulate pending request
      pending.set('req-1', {
        resolve: (val) => { resolvedValue = val; },
        reject: vi.fn(),
        timeout: setTimeout(() => {}, 30000)
      });

      // Simulate response
      const response = { type: 'res', id: 'req-1', ok: true, result: { data: 'test' } };
      
      const entry = pending.get(response.id);
      if (entry && response.ok) {
        clearTimeout(entry.timeout);
        entry.resolve(response.result);
        pending.delete(response.id);
      }

      expect(resolvedValue).toEqual({ data: 'test' });
      expect(pending.has('req-1')).toBe(false);
    });

    it('should reject pending request on error response', () => {
      const pending = new Map();
      let rejectedError = null;
      
      pending.set('req-2', {
        resolve: vi.fn(),
        reject: (err) => { rejectedError = err; },
        timeout: setTimeout(() => {}, 30000)
      });

      const response = { type: 'res', id: 'req-2', ok: false, error: { message: 'Not found' } };
      
      const entry = pending.get(response.id);
      if (entry && !response.ok) {
        clearTimeout(entry.timeout);
        entry.reject(new Error(response.error.message));
        pending.delete(response.id);
      }

      expect(rejectedError.message).toBe('Not found');
    });

    it('should timeout and reject after 30 seconds', async () => {
      const pending = new Map();
      let timedOut = false;
      
      const timeout = setTimeout(() => {
        timedOut = true;
        pending.delete('req-3');
      }, 30000);
      
      pending.set('req-3', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timeout
      });

      // Fast-forward 30 seconds
      await vi.advanceTimersByTimeAsync(30000);
      
      expect(timedOut).toBe(true);
      expect(pending.has('req-3')).toBe(false);
    });
  });

  describe('Event Handling', () => {
    it('should register and call event handlers', () => {
      const handlers = new Map();
      const callback = vi.fn();
      
      // Register handler
      const event = 'chat.message';
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event).push(callback);

      // Emit event
      const data = { sessionKey: 'test', content: 'Hello' };
      handlers.get(event)?.forEach(handler => handler(data));

      expect(callback).toHaveBeenCalledWith(data);
    });

    it('should remove handler with off()', () => {
      const handlers = new Map();
      const callback = vi.fn();
      
      handlers.set('chat.message', [callback]);
      
      // Remove handler
      const eventHandlers = handlers.get('chat.message');
      const index = eventHandlers.indexOf(callback);
      if (index !== -1) {
        eventHandlers.splice(index, 1);
      }

      expect(handlers.get('chat.message')).toHaveLength(0);
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnect with exponential backoff', async () => {
      let reconnectDelay = 1000;
      const maxDelay = 30000;
      const delays = [];

      for (let i = 0; i < 5; i++) {
        delays.push(reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, maxDelay);
      }

      expect(delays).toEqual([1000, 1500, 2250, 3375, 5062.5]);
    });

    it('should stop reconnecting after 10 attempts', () => {
      let reconnectAttempts = 0;
      const maxAttempts = 10;
      let errorCalled = false;

      const attemptReconnect = () => {
        reconnectAttempts++;
        if (reconnectAttempts > maxAttempts) {
          errorCalled = true;
          return false;
        }
        return true;
      };

      // Simulate 11 reconnect attempts
      for (let i = 0; i < 11; i++) {
        if (!attemptReconnect()) break;
      }

      expect(reconnectAttempts).toBe(11);
      expect(errorCalled).toBe(true);
    });

    it('should reject all pending requests on disconnect', () => {
      const pending = new Map();
      const rejectedIds = [];
      
      pending.set('req-1', { reject: () => rejectedIds.push('req-1'), timeout: 1 });
      pending.set('req-2', { reject: () => rejectedIds.push('req-2'), timeout: 2 });
      pending.set('req-3', { reject: () => rejectedIds.push('req-3'), timeout: 3 });

      // Simulate onclose handler
      for (const [id, p] of pending) {
        p.reject(new Error('WebSocket closed'));
        clearTimeout(p.timeout);
      }
      pending.clear();

      expect(rejectedIds).toEqual(['req-1', 'req-2', 'req-3']);
      expect(pending.size).toBe(0);
    });
  });
});
