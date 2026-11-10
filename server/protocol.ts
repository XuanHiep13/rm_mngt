/** Guacamole uses Unicode character lengths, not UTF-8 byte lengths. */
export const instruction = (...elements: string[]) =>
  elements.map((v) => `${Array.from(v).length}.${v}`).join(",") + ";";
export class ProtocolParser {
  private buffer = "";
  constructor(
    private receive: (elements: string[]) => void,
    private maxSize = 8 * 1024 * 1024,
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > this.maxSize)
      throw new Error("Protocol limit exceeded");
    let consumed = 0;
    while (consumed < this.buffer.length) {
      let index = consumed;
      const elements: string[] = [];
      let complete = false;
      while (index < this.buffer.length) {
        const dot = this.buffer.indexOf(".", index);
        if (dot < 0) {
          if (this.buffer.length - index > 10)
            throw new Error("Invalid protocol length");
          break;
        }
        const lengthString = this.buffer.slice(index, dot);
        if (!/^\d{1,8}$/.test(lengthString))
          throw new Error("Invalid protocol");
        const length = Number(lengthString);
        if (length > this.maxSize)
          throw new Error("Protocol element too large");
        let end = dot + 1,
          count = 0;
        while (count < length && end < this.buffer.length) {
          const point = this.buffer.codePointAt(end)!;
          // A chunk may split a UTF-16 surrogate pair (WebSocket strings).
          if (
            point >= 0xd800 &&
            point <= 0xdbff &&
            end === this.buffer.length - 1
          )
            break;
          end += point > 0xffff ? 2 : 1;
          count++;
        }
        if (count < length || end >= this.buffer.length) break;
        const separator = this.buffer[end];
        if (separator !== "," && separator !== ";")
          throw new Error("Invalid separator");
        elements.push(this.buffer.slice(dot + 1, end));
        if (elements.length > 256) throw new Error("Too many arguments");
        index = end + 1;
        if (separator === ";") {
          complete = true;
          break;
        }
      }
      if (!complete) break;
      consumed = index;
      this.receive(elements);
    }
    this.buffer = this.buffer.slice(consumed);
  }
}
