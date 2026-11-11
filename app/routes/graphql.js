// f. GraphQL Yoga endpoint
import { createSchema, createYoga } from 'graphql-yoga';

const yoga = createYoga({
  graphqlEndpoint: '/graphql',
  landingPage: false,
  schema: createSchema({
    typeDefs: /* GraphQL */ `
      type User { id: ID!, name: String! }
      type Query { hello(name: String): String!, user(id: ID!): User }
    `,
    resolvers: {
      Query: {
        hello: (_, { name }) => `Hello ${name ?? 'world'}`,
        user: (_, { id }) => ({ id, name: 'Ada' }),
      },
    },
  }),
});

export default { fetch: (request, env, ctx) => yoga.fetch(request, env, ctx) };
