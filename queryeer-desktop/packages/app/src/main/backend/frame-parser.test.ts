import { describe, expect, it } from "vitest";
import { FrameParser } from "./frame-parser.js";

function makeFrame(json: string): Buffer {
  const body = Buffer.from(json, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

describe("FrameParser", () => {
  it("parses a single complete frame", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    parser.feed(makeFrame('{"id":"1"}'));

    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("parses a frame split across two chunks", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    const full = makeFrame('{"id":"1"}');
    parser.feed(full.slice(0, 10));
    parser.feed(full.slice(10));

    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("parses multiple frames in a single chunk", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    parser.feed(Buffer.concat([makeFrame('{"a":1}'), makeFrame('{"b":2}')]));

    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("routes non-framing lines to onConsole", () => {
    const parser = new FrameParser();
    const consoleLines: string[] = [];
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);
    parser.onConsole = (line) => consoleLines.push(line);

    parser.feed(
      Buffer.concat([Buffer.from("hello from System.out\n", "utf8"), makeFrame('{"id":"1"}')])
    );

    expect(consoleLines).toEqual(["hello from System.out"]);
    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("handles \\n-only line separators (no \\r)", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    const body = Buffer.from('{"x":1}', "utf8");
    parser.feed(
      Buffer.concat([Buffer.from(`Content-Length: ${body.length}\n\n`, "ascii"), body])
    );

    expect(frames).toEqual(['{"x":1}']);
  });

  it("handles multi-byte UTF-8 body", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    const json = '{"msg":"héllo"}';
    parser.feed(makeFrame(json));

    expect(frames).toEqual([json]);
  });

  it("matches Content-Length header case-insensitively", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    const body = Buffer.from('{"id":"1"}', "utf8");
    parser.feed(
      Buffer.concat([Buffer.from(`content-length: ${body.length}\r\n\r\n`, "ascii"), body])
    );

    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("ignores spurious blank lines before the first header", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    parser.feed(Buffer.concat([Buffer.from("\r\n", "ascii"), makeFrame('{"id":"1"}')]));

    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("emits multiple console lines and still parses the frame", () => {
    const parser = new FrameParser();
    const consoleLines: string[] = [];
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);
    parser.onConsole = (line) => consoleLines.push(line);

    parser.feed(
      Buffer.concat([
        Buffer.from("line one\nline two\n", "utf8"),
        makeFrame('{"id":"1"}')
      ])
    );

    expect(consoleLines).toEqual(["line one", "line two"]);
    expect(frames).toEqual(['{"id":"1"}']);
  });

  it("body arrives byte by byte", () => {
    const parser = new FrameParser();
    const frames: string[] = [];
    parser.onFrame = (json) => frames.push(json);

    const full = makeFrame('{"id":"1"}');
    for (const byte of full) {
      parser.feed(Buffer.from([byte]));
    }

    expect(frames).toEqual(['{"id":"1"}']);
  });
});
