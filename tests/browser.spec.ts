import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { totp } from "../server/auth.js";
import net from "node:net";
import { once } from "node:events";
import { instruction, ProtocolParser } from "../server/protocol.js";
let child: ChildProcess, password: string, secret: string;
let mockGuacd: net.Server;
test.beforeAll(async () => {
  await mkdir(".local", { recursive: true });
  mockGuacd = net.createServer((socket) => {
    socket.setEncoding("utf8");
    const parser = new ProtocolParser((values) => {
      if (values[0] === "select")
        socket.write(
          instruction(
            "args",
            "VERSION_1_5_0",
            "hostname",
            "port",
            "username",
            "password",
          ),
        );
      if (values[0] === "connect")
        socket.write(
          instruction("ready", "$browser-test") +
            instruction("size", "0", "1024", "768") +
            instruction("rect", "0", "0", "0", "1024", "768") +
            instruction("cfill", "14", "0", "23", "40", "51", "255") +
            instruction("sync", String(Date.now())),
        );
    });
    socket.on("data", (chunk) => parser.push(String(chunk)));
    socket.on("error", () => {});
  });
  mockGuacd.listen(0, "127.0.0.1");
  await once(mockGuacd, "listening");
  child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/local-preview.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PREVIEW_PORT: process.env.TEST_PORT ?? "3000",
        PREVIEW_GUACD_PORT: String(
          (mockGuacd.address() as net.AddressInfo).port,
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Preview startup timed out")),
      30000,
    );
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code) reject(new Error("Preview server exited"));
    });
    child.stdout!.on("data", (chunk) => {
      output += chunk.toString();
      const pass = output.match(/Password: ([a-f0-9]+)/),
        mfa = output.match(/MFA secret \(temporary preview\): ([A-Z2-7]+)/);
      if (pass && mfa) {
        password = pass[1];
        secret = mfa[1];
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr!.on("data", () => {});
  });
});
test.afterAll(async () => {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 5000);
    });
  }
  if (mockGuacd)
    await new Promise<void>((resolve) => mockGuacd.close(() => resolve()));
});
test("real login, admin workflows and responsive layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Đăng nhập hệ thống" }),
  ).toBeVisible();
  await page.screenshot({ path: ".local/preview-login.png", fullPage: true });
  await page.getByLabel("Tên đăng nhập").fill("preview-admin");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Xác minh danh tính" }),
  ).toBeVisible();
  await page
    .getByLabel("Mã xác thực")
    .fill(totp(secret, "preview-admin").generate());
  await page.getByRole("button", { name: "Xác thực và tiếp tục" }).click();
  await expect(
    page.getByRole("heading", { name: "Tổng quan hệ thống" }),
  ).toBeVisible();
  await expect(page.locator(".stat-card").first().locator("strong")).toHaveText(
    "6",
  );
  await page.screenshot({ path: ".local/preview-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Máy ảo", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(6);
  await page.getByPlaceholder("Tìm tên máy, IP, nhóm…").fill("DB-MYSQL");
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Thêm máy ảo", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tên máy", { exact: true }).fill("QA-WINDOWS-01");
  await dialog.getByLabel("Địa chỉ IPv4").fill("10.10.10.25");
  await dialog.getByLabel("Tài khoản máy đích").fill("vm-user");
  await dialog
    .getByLabel("Mật khẩu máy đích")
    .fill("a temporary target secret");
  await dialog.getByRole("button", { name: "Lưu máy ảo" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Xóa tìm kiếm" }).click();
  await expect(page.locator(".asset-card")).toHaveCount(7);
  await page
    .locator(".asset-card")
    .filter({ hasText: "QA-WINDOWS-01" })
    .getByRole("button", { name: "Kết nối" })
    .click();
  await expect(page.getByText("Đã kết nối · Đang ghi phiên")).toBeVisible();
  await expect(page.locator(".remote-surface canvas").first()).toBeVisible();
  await page.screenshot({
    path: ".local/preview-remote.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Ngắt kết nối", exact: true }).click();
  await page
    .getByRole("button", { name: "Phiên truy cập", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Xem lại" })).toBeVisible();
  await page.getByRole("button", { name: "Xem lại" }).click();
  await expect(
    page.getByRole("button", { name: "Phát bản ghi" }),
  ).toBeEnabled();
  await expect(page.locator(".recording-surface canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Người dùng", exact: true }).click();
  await page.getByRole("button", { name: "Tạo người dùng" }).click();
  await page.getByLabel("Họ và tên").fill("Nhân viên kiểm thử");
  await page.getByLabel("Tên đăng nhập").fill("qa-operator");
  await page
    .getByLabel("Mật khẩu tạm thời")
    .fill("a very long temporary password");
  await page.getByRole("button", { name: "Lưu tài khoản" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("@qa-operator")).toBeVisible();
  await page.getByRole("button", { name: "Phân quyền", exact: true }).click();
  await page.getByRole("button", { name: "Cấp quyền truy cập" }).click();
  await page
    .getByLabel("Người dùng vận hành")
    .selectOption({ label: "Nhân viên kiểm thử (@qa-operator)" });
  await page
    .locator(".asset-select")
    .filter({ hasText: "QA-WINDOWS-01" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Cấp quyền 1 máy" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("@qa-operator")).toBeVisible();
  await page
    .getByRole("button", { name: "Nhật ký kiểm toán", exact: true })
    .click();
  await expect(
    page.getByText("Cấp quyền truy cập", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".csv");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("button", { name: "Tổng quan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tổng quan hệ thống" }),
  ).toBeVisible();
  if (await page.locator(".toast").isVisible())
    await page.getByRole("button", { name: "Đóng thông báo" }).click();
  await page.screenshot({
    path: ".local/preview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("SSH first-use dialog requires yes, supports cancel, and blocks changed keys", async ({ page }) => {
  let trusted = false, confirmations = 0, sessionRequests = 0, changed = false;
  await page.route("**/ssh-first-use-test", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><body><div id="root"></div><script type="module" src="/remote-test.tsx"></script></body></html>',
  }));
  await page.route("**/local-remote-test/bootstrap", (route) => route.fulfill({ json: {
    csrfToken: "test", asset: { id: "ssh-ui-test", name: "SSH UI test", host: "192.0.2.10", port: 22, protocol: "ssh", os: "linux", enabled: true },
  } }));
  await page.route("**/api/ssh/host-key", (route) => route.fulfill(changed
    ? { status: 409, json: { error: "KHÓA SSH ĐÃ THAY ĐỔI" } }
    : { json: { trusted, challenge: "challenge", host: "192.0.2.10", port: 22, type: "ecdsa-sha2-nistp256", fingerprint: "SHA256:test-fingerprint" } }));
  await page.route("**/api/ssh/host-key/confirm", (route) => {
    expect(route.request().postDataJSON().answer).toBe("yes");
    confirmations++; trusted = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/sessions", (route) => {
    sessionRequests++;
    return route.fulfill({ status: 503, json: { error: "Synthetic connection stopped after SSH verification" } });
  });
  await page.goto("/ssh-first-use-test");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("SHA256:test-fingerprint")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Xác nhận và kết nối" });
  await expect(confirm).toBeDisabled();
  expect(sessionRequests).toBe(0);
  await page.getByLabel("Gõ yes để tin cậy máy SSH").fill("no");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Gõ yes để tin cậy máy SSH").fill("yes");
  await confirm.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Synthetic connection");
  expect(confirmations).toBe(1);
  expect(sessionRequests).toBe(1);
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Synthetic connection");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(confirmations).toBe(1);
  expect(sessionRequests).toBe(2);
  changed = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("KHÓA SSH ĐÃ THAY ĐỔI");
  expect(sessionRequests).toBe(2);
  changed = false; trusted = false;
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Phiên thử SSH đã đóng" })).toBeVisible();
  expect(confirmations).toBe(1);
});
