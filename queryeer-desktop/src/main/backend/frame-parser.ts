export class FrameParser {
  private buffer = Buffer.alloc(0);
  private state: "header" | "body" = "header";
  private contentLength = -1;

  public onFrame: ((json: string) => void) | null = null;
  public onConsole: ((line: string) => void) | null = null;

  public feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (true) {
      if (this.state === "header") {
        const nlIdx = this.buffer.indexOf(0x0a);
        if (nlIdx === -1) break;

        const lineEnd = nlIdx > 0 && this.buffer[nlIdx - 1] === 0x0d ? nlIdx - 1 : nlIdx;
        const line = this.buffer.slice(0, lineEnd).toString("utf8");
        this.buffer = this.buffer.slice(nlIdx + 1);

        if (line.length === 0) {
          if (this.contentLength >= 0) {
            this.state = "body";
          }
          // spurious blank line — continue
        } else {
          const match = /^Content-Length: (\d+)$/i.exec(line);
          if (match) {
            this.contentLength = parseInt(match[1], 10);
          } else {
            this.onConsole?.(line);
          }
        }
      } else {
        if (this.buffer.length >= this.contentLength) {
          const json = this.buffer.slice(0, this.contentLength).toString("utf8");
          this.buffer = this.buffer.slice(this.contentLength);
          this.contentLength = -1;
          this.state = "header";
          this.onFrame?.(json);
        } else {
          break;
        }
      }
    }
  }
}
