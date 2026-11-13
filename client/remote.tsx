import { useEffect, useRef, useState } from "react";
import Guacamole from "guacamole-common-js";
import {
  ArrowLeft,
  Expand,
  ShieldCheck,
  Circle,
  Play,
  Pause,
} from "lucide-react";
import { post, type Asset, duration } from "./api";

export function Remote({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Đang xác thực quyền truy cập…");
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [verification, setVerification] = useState<{
    challenge: string; host: string; port: number; type: string; fingerprint: string;
  } | null>(null);
  const [answer, setAnswer] = useState("");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let client: any,
      keyboard: any,
      sessionId = "",
      disposed = false;
    const root = surface.current!;
    const resize = () => {
      const display = client?.getDisplay();
      if (display?.getWidth())
        display.scale(
          Math.min(
            root.clientWidth / display.getWidth(),
            (root.clientHeight - 8) / display.getHeight(),
            1.5,
          ),
        );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    const blur = () => keyboard?.reset();
    root.addEventListener("blur", blur);
    setStatus("Đang xác thực quyền truy cập…");
    void (async () => {
      if (asset.protocol === "ssh") {
        const trust = await post("/ssh/host-key", { assetId: asset.id });
        if (disposed) return;
        if (!trust.trusted) {
          setAnswer("");
          setVerification(trust);
          setStatus("Chờ xác nhận fingerprint SSH");
          return;
        }
      }
      const ticket = await post("/sessions", { assetId: asset.id });
      sessionId = ticket.sessionId;
      if (disposed) {
        await post(`/sessions/${sessionId}/terminate`).catch(() => {});
        return;
      }
      const tunnel = new Guacamole.WebSocketTunnel("/api/tunnel");
      client = new Guacamole.Client(tunnel);
      root.appendChild(client.getDisplay().getElement());
      client.getDisplay().onresize = resize;
      client.onstatechange = (state: number) => {
        if (disposed) return;
        if (state === 3) {
          setActive(true);
          setStatus("Đã kết nối · Đang ghi phiên");
          root.focus();
        }
        if (state === 5) {
          setActive(false);
          setStatus("Phiên đã kết thúc");
        }
      };
      client.onerror = () => {
        if (!disposed) {
          setError(
            "Kết nối không thành công hoặc đã bị ngắt. Kiểm tra dịch vụ RDP/SSH, thông tin xác thực và trạng thái gateway.",
          );
          setActive(false);
        }
      };
      const mouse = new Guacamole.Mouse(client.getDisplay().getElement());
      mouse.onmousedown =
        mouse.onmouseup =
        mouse.onmousemove =
          (state: any) => {
            root.focus();
            const scale = client.getDisplay().getScale();
            client.sendMouseState({
              ...state,
              x: state.x / scale,
              y: state.y / scale,
            });
          };
      keyboard = new Guacamole.Keyboard(root);
      keyboard.onkeydown = (key: number) => {
        client.sendKeyEvent(1, key);
        return false;
      };
      keyboard.onkeyup = (key: number) => client.sendKeyEvent(0, key);
      client.connect(`ticket=${encodeURIComponent(ticket.ticket)}`);
      setStatus("Đang kết nối tới máy đích…");
    })().catch((e) => {
      if (!disposed) { setError(e.message); setStatus("Không thể kết nối"); }
    });
    return () => {
      disposed = true;
      observer.disconnect();
      root.removeEventListener("blur", blur);
      keyboard?.reset();
      client?.disconnect();
      root.replaceChildren();
      if (sessionId)
        void post(`/sessions/${sessionId}/terminate`).catch(() => {});
    };
  }, [asset.id, attempt]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div className="remote-workspace">
      <header>
        <button className="icon-button" aria-label="Quay lại" onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
        <div>
          <strong>{asset.name}</strong>
          <span>
            {asset.protocol.toUpperCase()} · {asset.host}
          </span>
        </div>
        <div className="remote-status">
          <Circle size={8} fill={active ? "#4ade80" : "#94a3b8"} />
          {status}
        </div>
        <span className="mono">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
        <button
          className="icon-button"
          aria-label="Toàn màn hình"
          onClick={() =>
            void document
              .querySelector(".remote-workspace")
              ?.requestFullscreen()
              .catch(() => {})
          }
        >
          <Expand size={18} />
        </button>
        <button className="button danger" onClick={onClose}>
          Ngắt kết nối
        </button>
      </header>
      {verification && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="ssh-trust-title">
            <h2 id="ssh-trust-title">Xác nhận máy SSH lần đầu</h2>
            <p>Chưa có khóa đã lưu cho {verification.host}:{verification.port}.</p>
            <p>Loại khóa: <strong>{verification.type}</strong></p>
            <p className="mono" style={{ overflowWrap: "anywhere" }}>{verification.fingerprint}</p>
            <p>Kiểm tra fingerprint của máy đích. Gõ <strong>yes</strong> để lưu khóa và tiếp tục.</p>
            <form onSubmit={async (event) => {
              event.preventDefault();
              if (answer !== "yes" || confirming) return;
              setConfirming(true);
              try {
                await post("/ssh/host-key/confirm", { assetId: asset.id, challenge: verification.challenge, answer });
                setVerification(null);
                setError("");
                setAttempt((value) => value + 1);
              } catch (e: any) {
                setError(e.message);
                setVerification(null);
                setStatus("Không thể xác nhận khóa SSH");
              } finally { setConfirming(false); }
            }}>
              <input autoFocus aria-label="Gõ yes để tin cậy máy SSH" value={answer}
                onChange={(event) => setAnswer(event.target.value)} autoComplete="off" disabled={confirming} />
              <div className="modal-actions">
                <button type="button" className="button secondary" disabled={confirming} onClick={onClose}>Hủy</button>
                <button className="button" disabled={answer !== "yes" || confirming}>
                  {confirming ? "Đang lưu…" : "Xác nhận và kết nối"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {error && (
        <div className="remote-error" role="alert">
          {error}
        </div>
      )}
      <div
        className="remote-surface"
        tabIndex={0}
        ref={surface}
        aria-label="Màn hình máy từ xa"
      />
      <footer>
        <ShieldCheck size={14} /> Phiên truy cập được ghi lại. Clipboard và
        truyền tệp đã được tắt.
        <span>Nhấp vào màn hình để điều khiển bàn phím.</span>
      </footer>
    </div>
  );
}

export function Recording({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    player = useRef<any>(null);
  const [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0),
    [length, setLength] = useState(0);
  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    const fit = () => {
      const d = player.current?.getDisplay();
      if (d?.getWidth())
        d.scale(Math.min((root.current!.clientWidth - 20) / d.getWidth(), 1));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root.current!);
    void (async () => {
      const response = await fetch(`/api/sessions/${sessionId}/recording`, {
        credentials: "same-origin",
        signal: abort.signal,
      });
      if (!response.ok)
        throw new Error("Không thể tải bản ghi hoặc bạn không có quyền xem.");
      if (disposed) return;
      // Use a streamed Tunnel source. The packaged 1.5 Blob constructor fails
      // before assigning recordingBlob; the Tunnel API is supported and lets
      // us handle fetch errors and cancellation explicitly.
      const source = new Guacamole.Tunnel();
      const recording = new Guacamole.SessionRecording(source);
      player.current = recording;
      root.current!.appendChild(recording.getDisplay().getElement());
      recording.getDisplay().onresize = fit;
      recording.onload = () => {
        if (!disposed) {
          setLength(recording.getDuration());
          setLoaded(true);
          recording.seek(0);
        }
      };
      recording.onerror = () => {
        if (!disposed) setError("Không đọc được tệp bản ghi.");
      };
      recording.onplay = () => setPlaying(true);
      recording.onpause = () => setPlaying(false);
      recording.onseek = () => setPosition(recording.getPosition());
      const parser = new Guacamole.Parser();
      parser.oninstruction = (opcode: string, args: string[]) =>
        source.oninstruction?.(opcode, args);
      source.setState(Guacamole.Tunnel.State.OPEN);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (!disposed) {
        const { value, done } = await reader.read();
        if (done) {
          const tail = decoder.decode();
          if (tail) parser.receive(tail);
          break;
        }
        parser.receive(decoder.decode(value, { stream: true }));
      }
      if (!disposed) source.setState(Guacamole.Tunnel.State.CLOSED);
    })().catch((e) => {
      if (!disposed) setError(e.message);
    });
    const timer = setInterval(() => {
      if (player.current) setPosition(player.current.getPosition());
    }, 300);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      clearInterval(timer);
      player.current?.pause();
      player.current?.cancel();
      player.current?.abort();
      player.current = null;
      root.current?.replaceChildren();
    };
  }, [sessionId]);
  return (
    <div className="recording">
      <div className="modal-title">
        <div>
          <h2>Xem lại phiên làm việc</h2>
          <p className="mono">{sessionId}</p>
        </div>
        <button className="button secondary" onClick={onClose}>
          Đóng
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div ref={root} className="recording-surface" />
      {!loaded && !error && <p>Đang tải bản ghi…</p>}
      <div className="player-controls">
        <button
          aria-label={playing ? "Tạm dừng" : "Phát bản ghi"}
          className="icon-button"
          disabled={!loaded}
          onClick={() =>
            playing ? player.current.pause() : player.current.play()
          }
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <span>{duration(1, position + 1)}</span>
        <input
          aria-label="Vị trí phát lại"
          type="range"
          min="0"
          max={length || 1}
          value={position}
          disabled={!loaded}
          onChange={(e) => {
            const value = Number(e.target.value);
            setPosition(value);
            player.current?.seek(value);
          }}
        />
        <span>{duration(1, length + 1)}</span>
      </div>
    </div>
  );
}
