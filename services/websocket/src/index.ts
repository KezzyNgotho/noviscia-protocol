import WebSocket from 'ws';
import http from 'http';
import { EventEmitter } from 'events';

/**
 * Novisca WebSocket Server - Real-time updates
 * 
 * Channels:
 * - prices: Real-time price feeds for markets
 * - orderbook: Order book updates
 * - positions: User position updates
 * - yields: Yield earnings in real-time
 * - trades: Recent trades broadcast
 */
export class NoviscaWebSocketServer extends EventEmitter {
  private wss: WebSocket.Server;
  private server: http.Server;
  private port: number;
  private clients: Map<string, Set<WebSocket>> = new Map(); // channel -> clients

  constructor(port: number = 8080) {
    super();
    this.port = port;
    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocket.Server({ server: this.server });
    this.setupConnectionHandler();
  }

  /** Internal ingest for keeper AI liquidation alerts */
  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'noviscia-websocket', port: this.port }));
      return;
    }
    if (req.method === 'POST' && req.url === '/internal/broadcast') {
      const ingestSecret = process.env.WS_INGEST_SECRET || process.env.WEBSOCKET_INGEST_SECRET || '';
      if (ingestSecret) {
        const auth = req.headers['x-ingest-secret'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (auth !== ingestSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const { channel, data } = JSON.parse(body);
          if (!channel || !data) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'channel and data required' }));
            return;
          }
          this.broadcast(channel, data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, channel }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'invalid json' }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }

  broadcastAlert(data: {
    type: string;
    wallet?: string;
    probability: number;
    message: string;
    severity: string;
    timestamp: number;
  }): void {
    this.broadcast('alerts:global', { type: 'alert', ...data });
    if (data.wallet) {
      this.broadcast(`alerts:${data.wallet}`, { type: 'alert', ...data });
    }
  }

  /**
   * Setup connection handler
   */
  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('🔌 WebSocket client connected');

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data);
          this.handleClientMessage(ws, message);
        } catch (error) {
          console.error('❌ Invalid message:', error);
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket client disconnected');
        this.removeClientFromAllChannels(ws);
      });

      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
      });
    });
  }

  /**
   * Handle incoming client message
   */
  private handleClientMessage(ws: WebSocket, message: any): void {
    const { action, channel } = message;

    if (action === 'subscribe') {
      this.subscribeClient(ws, channel);
      ws.send(JSON.stringify({ success: true, channel, action: 'subscribed' }));
    } else if (action === 'unsubscribe') {
      this.unsubscribeClient(ws, channel);
      ws.send(JSON.stringify({ success: true, channel, action: 'unsubscribed' }));
    } else {
      ws.send(JSON.stringify({ error: 'Unknown action' }));
    }
  }

  /**
   * Subscribe client to channel
   */
  private subscribeClient(ws: WebSocket, channel: string): void {
    if (!this.clients.has(channel)) {
      this.clients.set(channel, new Set());
    }
    this.clients.get(channel)!.add(ws);
    console.log(`✅ Client subscribed to ${channel}`);
  }

  /**
   * Unsubscribe client from channel
   */
  private unsubscribeClient(ws: WebSocket, channel: string): void {
    const clients = this.clients.get(channel);
    if (clients) {
      clients.delete(ws);
      console.log(`✅ Client unsubscribed from ${channel}`);
    }
  }

  /**
   * Remove client from all channels
   */
  private removeClientFromAllChannels(ws: WebSocket): void {
    for (const [channel, clients] of this.clients.entries()) {
      clients.delete(ws);
    }
  }

  /**
   * Broadcast price update
   * 
   * Used by: Price Feed Service
   */
  broadcastPrice(symbol: string, data: {
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
    timestamp: number;
  }): void {
    const channel = `prices:${symbol}`;
    this.broadcast(channel, {
      type: 'price',
      symbol,
      ...data,
    });
  }

  /**
   * Broadcast orderbook update
   * 
   * Used by: Indexer / Oracle
   */
  broadcastOrderBook(symbol: string, data: {
    bids: [number, number][];
    asks: [number, number][];
    timestamp: number;
  }): void {
    const channel = `orderbook:${symbol}`;
    this.broadcast(channel, {
      type: 'orderbook',
      symbol,
      ...data,
    });
  }

  /**
   * Broadcast position update
   * 
   * Used by: Keeper Bot / Indexer
   */
  broadcastPosition(wallet: string, data: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entry_price: number;
    mark_price: number;
    liquidation_price: number;
    pnl: number;
    pnl_percentage: number;
    leverage: number;
    margin_ratio: number;
    timestamp: number;
  }): void {
    const channel = `positions:${wallet}`;
    this.broadcast(channel, {
      type: 'position',
      wallet,
      ...data,
    });
  }

  /**
   * Broadcast yield earning update
   * 
   * Real-time ticker showing idle yield accumulation
   */
  broadcastYield(wallet: string, data: {
    earned_this_hour: number;
    earned_today: number;
    projected_daily: number;
    projected_annual: number;
    active_protocol: string;
    apy: number;
    timestamp: number;
  }): void {
    const channel = `yields:${wallet}`;
    this.broadcast(channel, {
      type: 'yield',
      wallet,
      ...data,
    });
  }

  /**
   * Broadcast recent trade
   * 
   * Used by: Market data broadcast
   */
  broadcastTrade(data: {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    timestamp: number;
  }): void {
    const channel = 'trades';
    this.broadcast(channel, {
      type: 'trade',
      ...data,
    });
  }

  /**
   * Internal broadcast to channel subscribers
   */
  private broadcast(channel: string, data: any): void {
    const clients = this.clients.get(channel);
    if (clients && clients.size > 0) {
      const message = JSON.stringify({ channel, ...data });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  }

  /**
   * Start server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🚀 WebSocket server running on ws://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.clients.forEach((client) => {
        client.close();
      });
      this.server.close(() => {
        console.log('🛑 WebSocket server stopped');
        resolve();
      });
    });
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalClients: number;
    channels: Record<string, number>;
  } {
    let totalClients = 0;
    const channels: Record<string, number> = {};

    for (const [channel, clients] of this.clients.entries()) {
      channels[channel] = clients.size;
      totalClients += clients.size;
    }

    return { totalClients, channels };
  }
}

// Start server
const wsServer = new NoviscaWebSocketServer(parseInt(process.env.WEBSOCKET_PORT || '8080'));
wsServer.start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 WebSocket server shutting down...');
  await wsServer.stop();
  process.exit(0);
});
