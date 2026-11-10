import { BlockList, isIPv4 } from "node:net";
import { requireValue } from "./errors.js";
export function targetPolicy(cidrs: string) {
  const list = new BlockList();
  for (const entry of cidrs
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)) {
    const [ip, prefix] = entry.split("/");
    if (
      !isIPv4(ip) ||
      !/^\d+$/.test(prefix ?? "") ||
      Number(prefix) < 0 ||
      Number(prefix) > 32
    )
      throw new Error("Invalid ALLOWED_TARGET_CIDRS");
    list.addSubnet(ip, Number(prefix), "ipv4");
  }
  return (host: string) => {
    requireValue(
      isIPv4(host) &&
        list.check(host, "ipv4") &&
        !host.startsWith("127.") &&
        !host.startsWith("169.254.") &&
        host !== "0.0.0.0",
      400,
      "Địa chỉ máy phải là IPv4 nằm trong dải mạng được cho phép.",
    );
  };
}
