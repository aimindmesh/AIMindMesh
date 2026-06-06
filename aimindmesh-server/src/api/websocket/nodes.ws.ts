import { FastifyInstance } from 'fastify';
import { InferenceRouter } from '../../services/InferenceRouter';
import { Logger } from '../../utils/Logger';

export default async function (fastify: FastifyInstance) {
  fastify.get('/ws/nodes', { websocket: true }, (connection, req) => {
    const query = req.query as { id?: string; name?: string };
    Logger.info('NodesWS', `Incoming WebSocket connection attempt from ${req.ip} with query: ${JSON.stringify(query)}`);

    if (!query.id) {
      Logger.warn('NodesWS', 'Connection rejected: Missing node ID');
      connection.close(1008, 'Missing node ID');
      return;
    }
    const nodeId = query.id.toUpperCase();

    Logger.info('NodesWS', `Mobile worker node [${nodeId}] connected from ${req.ip}`);
    
    // Handle reconnection: Cleanup old socket and associated tasks if they exist
    const existing = InferenceRouter.nodeSockets.get(nodeId);
    if (existing) {
      Logger.warn('NodesWS', `Node [${nodeId}] reconnected before old connection closed. Cleaning up session...`);
      InferenceRouter.handleNodeDisconnection(nodeId);
      try { (existing as any).close(); } catch(e) {}
    }

    const socket = (connection as any).socket || connection;
    InferenceRouter.nodeSockets.set(nodeId, socket);
    (connection as any).nodeId = nodeId; 

    // Force node to be ONLINE in the registry when WS connects
    const { NodeRegistry } = require('../../services/NodeRegistry');
    NodeRegistry.registerNode({ 
      id: nodeId, 
      type: 'mobile', 
      status: 'ONLINE',
      name: query.name 
    });

    // Heartbeat mechanism: Respond to pings from client and log pongs
    socket.on('ping', () => {
       Logger.debug('NodesWS', `Received PING from worker [${nodeId}]`);
       socket.pong();
    });
    socket.on('pong', () => {
       Logger.debug('NodesWS', `Received PONG from worker [${nodeId}]`);
       NodeRegistry.heartbeat(nodeId);
    });

    // Active Heartbeat: Server pings client every 10s to keep connection alive and detect half-open sockets
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState === 1) { // OPEN
        socket.ping();
        // Also send a data-layer heartbeat for visibility in logcat
        Logger.debug('NodesWS', `Sending TEST_HEARTBEAT to [${nodeId}]`);
        socket.send(JSON.stringify({ type: 'TEST_HEARTBEAT', nodeId, timestamp: Date.now() }));
      } else {
        Logger.warn('NodesWS', `Socket for [${nodeId}] state is ${socket.readyState}, clearing heartbeat.`);
        clearInterval(heartbeatInterval);
      }
    }, 10000);

    socket.on('message', (message: any) => {
      try {
        const raw = message.toString();
        Logger.debug('NodesWS', `Message from [${nodeId}]: ${raw.substring(0, 100)}${raw.length > 100 ? '...' : ''}`);
        
        const data = JSON.parse(raw);
        
        if (data.type === 'token' && data.id) {
           InferenceRouter.onTaskUpdate(data.id, { type: 'token', content: data.token });
           return;
        }

        if (data.type === 'thinking' && data.id) {
           InferenceRouter.onTaskUpdate(data.id, { type: 'thinking', content: data.content });
           return;
        }

        if (data.type === 'result' && data.id) {
           const entry = InferenceRouter.pendingMobileTasks.get(data.id);
           if (entry) {
             Logger.info('NodesWS', `Received result for task ${data.id} from [${nodeId}]`);
             entry.callback(data);
           } else {
             Logger.warn('NodesWS', `Received result for unknown/expired task ${data.id}`);
           }
        }
      } catch (err) {
        Logger.error('NodesWS', `Failed to parse message from node ${nodeId}: ` + err);
      }
    });

    socket.on('close', () => {
      Logger.info('NodesWS', `Mobile worker node [${nodeId}] disconnected`);
      clearInterval(heartbeatInterval);
      NodeRegistry.updateStatus(nodeId, 'OFFLINE');
      InferenceRouter.handleNodeDisconnection(nodeId);
      if (InferenceRouter.nodeSockets.get(nodeId) === connection) {
        InferenceRouter.nodeSockets.delete(nodeId);
      }
    });
    
    socket.on('error', (err: any) => {
      Logger.error('NodesWS', `Connection error on node [${nodeId}]: ` + err.message);
    });
  });
}
