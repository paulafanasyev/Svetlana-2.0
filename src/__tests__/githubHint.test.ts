import { describe, it, expect } from 'vitest';
import { mcpServer } from '../services/mcp/McpCatalog';

describe('GitHub token hint', () => {
  it('asks for the Workflows permission needed to set up site auto-deploy', () => {
    expect(mcpServer('github')!.tokenHint).toMatch(/Workflows: Read and write/);
  });
});
