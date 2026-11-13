import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Remote } from "./remote";
import { setCsrf, type Asset } from "./api";
import "./style.css";

function DirectRemote({ asset }: { asset: Asset }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <Remote asset={asset} onClose={() => setOpen(false)} />
  ) : (
    <main className="panel" style={{ margin: 32, padding: 24 }}>
      <h1>Phiên thử {asset.protocol.toUpperCase()} đã đóng</h1>
      <p>{asset.host}:{asset.port}</p>
      <button className="button" onClick={() => setOpen(true)}>Kết nối lại</button>
    </main>
  );
}

async function start() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const response = await fetch("/local-remote-test/bootstrap", {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Local-Remote-Test": "1" },
    });
    if (!response.ok) throw new Error("Không khởi tạo được phiên local. Hãy chạy npm run remote:test và mở http://localhost:3000.");
    const result = await response.json();
    setCsrf(result.csrfToken);
    root.render(<DirectRemote asset={result.asset} />);
  } catch (error) {
    root.render(<p role="alert">{error instanceof Error ? error.message : "Không thể mở phiên thử."}</p>);
  }
}
void start();
