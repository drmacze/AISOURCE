import { defineConfig } from "orval";

export default defineConfig({
  "api-client-react": {
    input: "./openapi.yaml",
    output: {
      target: "../../lib/api-client-react/src/index.ts",
      client: "react-query",
      httpClient: "fetch",
      override: {
        mutator: {
          path: "../../lib/api-client-react/src/fetcher.ts",
          name: "apiFetch",
        },
        query: {
          useQuery: true,
          useMutation: true,
          signal: true,
        },
      },
      mock: false,
      prettier: true,
    },
  },
  "api-zod": {
    input: "./openapi.yaml",
    output: {
      target: "../../lib/api-zod/src/index.ts",
      client: "zod",
      mock: false,
      prettier: true,
    },
  },
});
