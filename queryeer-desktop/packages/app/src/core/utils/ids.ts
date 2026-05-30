/** Generates a stable connection identifier (UUID v4). */
export function generateConnectionId(): string {
  return crypto.randomUUID();
}
