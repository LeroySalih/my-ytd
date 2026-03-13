export default async function healthRoutes(fastify) {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });
}
