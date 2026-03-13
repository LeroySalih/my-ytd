import Fastify from 'fastify';
import healthRoutes from './routes/health.js';
import transcriptRoutes from './routes/transcript.js';

function getEnvPort() {
  const raw = process.env.PORT ?? '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[startup] Invalid PORT "${raw}": must be an integer between 1 and 65535`);
    process.exit(1);
  }
  return port;
}

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = getEnvPort();

const fastify = Fastify({ logger: true });

fastify.register(healthRoutes);
fastify.register(transcriptRoutes);

process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received — closing server');
  await fastify.close();
  process.exit(0);
});

try {
  await fastify.listen({ port: PORT, host: HOST });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
