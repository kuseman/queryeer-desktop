export class BackendNotReadyError extends Error {
  public constructor() {
    super("Backend is not up and running yet. Please wait a moment and try again.");
  }
}
