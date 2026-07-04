import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export function initSocketGateway(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' }, // tighten to the dashboard origin in production
  });

  // Dedicated subscriber connection — ioredis connections in subscribe mode
  // can't issue other commands, so this must be separate from the shared
  // `redis` client used for locks/rate limiting elsewhere.
  const subscriber = new Redis(env.redisUrl);
  const subscribedProjects = new Set<string>();

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Missing auth token'));
      const payload = jwt.verify(token, env.jwtSecret) as { sub: string; email: string };
      (socket.data as any).userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid auth token'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('subscribe:project', async (projectId: string) => {
      socket.join(`project:${projectId}`);
      if (!subscribedProjects.has(projectId)) {
        subscribedProjects.add(projectId);
        await subscriber.subscribe(`events:${projectId}`);
      }
    });

    socket.on('unsubscribe:project', (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    socket.on('disconnect', () => {
      // Rooms are cleaned up automatically by socket.io on disconnect.
    });
  });

  subscriber.on('message', (channel, message) => {
    const projectId = channel.replace('events:', '');
    io.to(`project:${projectId}`).emit('event', JSON.parse(message));
  });

  subscriber.on('error', (err) => logger.error({ err }, 'Redis subscriber error'));

  return io;
}
