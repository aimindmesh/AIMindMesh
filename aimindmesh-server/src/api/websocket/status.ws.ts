import { FastifyInstance } from 'fastify';
import { AdminService } from '../../services/AdminService';
import { Logger } from '../../utils/Logger';

export default async function (fastify: FastifyInstance) {
  fastify.get('/ws/status', { websocket: true }, (connection: any, req) => {
    Logger.info('StatusWS', 'Admin telemetry link established');
    
    // Using any for the connection object directly to bypass Fastify 5 + WebSocket v11 type mismatches
    const sendPulse = async () => {
      try {
        const status = await AdminService.getStatus();
        if (connection.socket && connection.socket.readyState === 1) { // 1 = OPEN
           connection.socket.send(JSON.stringify({ type: 'status', data: status }));
        }
      } catch (err) {
        Logger.error('StatusWS', 'Telemetry pulse failed');
      }
    };

    // Send immediate pulse on connect
    sendPulse();

    const interval = setInterval(sendPulse, 8000);

    if (connection.socket) {
      connection.socket.on('close', () => {
        clearInterval(interval);
        Logger.info('StatusWS', 'Admin telemetry link terminated');
      });
    }
  });
}
