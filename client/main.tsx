import React, {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Eye,
  FileClock,
  Fingerprint,
  Folder,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Terminal,
  Users,
  X,
  Menu,
  ExternalLink,
} from "lucide-react";
import {
  api,
  post,
  setCsrf,
  csrfToken,
  date,
  duration,
  roleName,
  type User,
  type Asset,
} from "./api";
import { Remote, Recording } from "./remote";
import "./style.css";

type View =
  | "overview"
  | "assets"
  | "users"
  | "grants"
  | "sessions"
  | "audit"
  | "settings";
const navigation: {
  id: View;
  title: string;
  icon: typeof Monitor;
  section?: string;
  roles?: string[];
}[] = [
  {
    id: "overview",
    title: "Tổng quan",
    icon: LayoutDashboard,
    section: "KHÔNG GIAN LÀM VIỆC",
  },
  { id: "assets", title: "Máy ảo", icon: Monitor },
  { id: "sessions", title: "Phiên truy cập", icon: Activity },
  {
    id: "users",
    title: "Người dùng",
    icon: Users,
    section: "QUẢN TRỊ HỆ THỐNG",
    roles: ["admin"],
  },
  { id: "grants", title: "Phân quyền", icon: KeyRound, roles: ["admin"] },
  {
    id: "audit",
    title: "Nhật ký kiểm toán",
    icon: FileClock,
    roles: ["admin", "auditor"],
  },
  {
    id: "settings",
    title: "Cấu hình hệ thống",
    icon: Settings2,
    roles: ["admin"],
  },
];
function useLoad<T = any>(url: string | null, refresh = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api<T>(url)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, refresh]);
  return { data, error, loading };
}
function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <div className="brand-mark">
        <Layers3 size={24} strokeWidth={1.8} />
      </div>
      <div>
        <strong>
          VM<span>Access</span>
        </strong>
        <small>SECURE INFRASTRUCTURE</small>
      </div>
    </div>
  );
}
function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  icon: Icon = Monitor,
  title,
  text,
  action,
}: {
  icon?: typeof Monitor;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function ErrorBox({ text }: { text?: string }) {
  return text ? (
    <div className="alert error" role="alert">
      {text}
    </div>
  ) : null;
}
function Loading() {
  return (
    <div className="loading">
      <span className="spinner" /> Đang tải dữ liệu…
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const previous = document.activeElement as HTMLElement;
    const timer = setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(".modal input,.modal button")
          ?.focus(),
      0,
    );
    return () => {
      document.removeEventListener("keydown", handler);
      clearTimeout(timer);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const nodes = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',
            ),
          );
          if (!nodes.length) return;
          if (e.shiftKey && document.activeElement === nodes[0]) {
            e.preventDefault();
            nodes.at(-1)!.focus();
          } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
            e.preventDefault();
            nodes[0].focus();
          }
        }}
      >
        <div className="modal-title">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="Đóng" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Pager({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total
          ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} trong ${total} mục`
          : "0 mục"}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Trang trước"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span>Trang {page}</span>
        <button
          className="icon-button"
          aria-label="Trang sau"
          disabled={page * limit >= total}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder = "Tìm kiếm…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="icon-button"
          aria-label="Xóa tìm kiếm"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(""),
    [setup, setSetup] = useState<any>(null),
    [codes, setCodes] = useState<string[]>([]),
    [pendingUser, setPendingUser] = useState<User | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (!challenge) {
        const result = await post("/auth/login", { username, password });
        setPassword("");
        setChallenge(result.challenge);
        if (result.needsEnrollment)
          setSetup(
            await post("/auth/mfa/setup", { challenge: result.challenge }),
          );
      } else {
        const result = await post("/auth/mfa/verify", { challenge, code });
        setCsrf(result.csrfToken);
        if (result.recoveryCodes?.length) {
          setCodes(result.recoveryCodes);
          setPendingUser(result.user);
        } else onLogin(result.user);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <aside className="login-story">
        <Brand light />
        <div className="login-story-body">
          <span className="eyebrow">CỔNG TRUY CẬP HẠ TẦNG NỘI BỘ</span>
          <h1>
            Một điểm truy cập.
            <br />
            Toàn bộ hạ tầng.
            <br />
            <em>Trong tầm kiểm soát.</em>
          </h1>
          <p>
            Kết nối an toàn tới máy chủ Windows và Linux, ngay trong trình duyệt
            của bạn.
          </p>
          <div className="network-art" aria-hidden="true">
            <div className="network-center">
              <ShieldCheck size={42} />
            </div>
            <div className="network-node node-1">
              <Monitor size={23} />
              <span>Windows</span>
            </div>
            <div className="network-node node-2">
              <Terminal size={23} />
              <span>Linux</span>
            </div>
            <div className="network-node node-3">
              <Server size={23} />
              <span>Hạ tầng nội bộ</span>
            </div>
          </div>
          <div className="login-benefits">
            <span>
              <Fingerprint size={17} />
              Xác thực nhiều lớp
            </span>
            <span>
              <Eye size={17} />
              Kiểm toán phiên
            </span>
            <span>
              <LockKeyhole size={17} />
              Bảo vệ thông tin xác thực
            </span>
          </div>
        </div>
        <small>VM Access · Dành cho mạng nội bộ qua VPN</small>
      </aside>
      <main className="login-main">
        <div className="login-card">
          <div className="login-lock">
            {challenge ? <Fingerprint size={26} /> : <LockKeyhole size={25} />}
          </div>
          {codes.length ? (
            <>
              <h2>Lưu mã khôi phục</h2>
              <p>
                Mỗi mã chỉ dùng một lần khi bạn mất ứng dụng xác thực. Hãy lưu ở
                nơi an toàn trước khi tiếp tục.
              </p>
              <div className="recovery-codes">
                {codes.map((c) => (
                  <code key={c}>{c}</code>
                ))}
              </div>
              <button
                className="button secondary full"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(codes.join("\n"))
                    .catch(() =>
                      setError("Không sao chép được. Hãy lưu mã thủ công."),
                    )
                }
              >
                <Copy size={16} /> Sao chép mã
              </button>
              <button
                className="button full"
                onClick={() => onLogin(pendingUser!)}
              >
                Tôi đã lưu mã khôi phục <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <>
              <span className="eyebrow">CHÀO MỪNG BẠN TRỞ LẠI</span>
              <h2>
                {challenge
                  ? setup
                    ? "Thiết lập xác thực hai lớp"
                    : "Xác minh danh tính"
                  : "Đăng nhập hệ thống"}
              </h2>
              <p>
                {challenge
                  ? "Nhập mã từ ứng dụng xác thực hoặc mã khôi phục của bạn."
                  : "Sử dụng tài khoản được cấp để truy cập không gian làm việc."}
              </p>
              <form onSubmit={submit}>
                <ErrorBox text={error} />
                {!challenge ? (
                  <>
                    <Field label="Tên đăng nhập">
                      <input
                        autoComplete="username"
                        autoFocus
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Nhập tên đăng nhập"
                      />
                    </Field>
                    <Field label="Mật khẩu">
                      <input
                        autoComplete="current-password"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Nhập mật khẩu của bạn"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    {setup && (
                      <div className="mfa-enrollment">
                        <img
                          src={setup.qrCode}
                          alt="Mã QR thiết lập ứng dụng xác thực"
                        />
                        <p>
                          Quét bằng ứng dụng xác thực. Nếu không quét được, nhập
                          khóa:
                        </p>
                        <code>{setup.secret}</code>
                      </div>
                    )}
                    <Field label="Mã xác thực">
                      <input
                        autoFocus
                        autoComplete="one-time-code"
                        required
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="000000"
                        maxLength={64}
                      />
                    </Field>
                  </>
                )}
                <button className="button full" disabled={busy}>
                  {busy ? (
                    <span className="spinner" />
                  ) : (
                    <>
                      {challenge ? "Xác thực và tiếp tục" : "Đăng nhập"}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
                {challenge && (
                  <button
                    type="button"
                    className="text-button full"
                    onClick={() => {
                      setChallenge("");
                      setCode("");
                      setSetup(null);
                      setError("");
                    }}
                  >
                    Quay lại đăng nhập
                  </button>
                )}
              </form>
            </>
          )}
          <div className="login-note">
            <ShieldCheck size={17} />
            <span>
              Mỗi người một tài khoản. Mọi phiên truy cập đều được ghi lại.
            </span>
          </div>
        </div>
        <div className="login-footer">
          <span className="status-dot" /> Hệ thống nội bộ · HTTPS + VPN
        </div>
      </main>
    </div>
  );
}

function PasswordForm({
  forced,
  onDone,
}: {
  forced: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("new") !== f.get("repeat")) {
          setError("Mật khẩu nhập lại chưa khớp.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await post("/auth/password", {
            currentPassword: f.get("current"),
            newPassword: f.get("new"),
          });
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        {forced
          ? "Đổi mật khẩu được cấp trước khi sử dụng hệ thống."
          : "Các phiên remote và phiên đăng nhập khác sẽ được kết thúc."}
      </p>
      <ErrorBox text={error} />
      <Field label="Mật khẩu hiện tại">
        <input
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field
        label="Mật khẩu mới"
        hint="Tối thiểu 14 ký tự. Ưu tiên một cụm từ dài, riêng biệt."
      >
        <input
          name="new"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={128}
          required
        />
      </Field>
      <Field label="Nhập lại mật khẩu mới">
        <input
          name="repeat"
          type="password"
          autoComplete="new-password"
          minLength={14}
          maxLength={128}
          required
        />
      </Field>
      <button className="button full" disabled={busy}>
        {busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
      </button>
    </form>
  );
}

function AssetForm({
  asset,
  onDone,
  onClose,
}: {
  asset?: Asset;
  onDone: () => void;
  onClose: () => void;
}) {
  const [protocol, setProtocol] = useState(asset?.protocol ?? "rdp"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [port, setPort] = useState(asset?.port ?? 3389);
  return (
    <Modal
      title={asset ? "Cấu hình máy ảo" : "Thêm máy ảo"}
      subtitle="Thông tin xác thực chỉ được sử dụng ở gateway."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          const input = {
            name: f.get("name"),
            host: f.get("host"),
            port,
            protocol,
            os: f.get("os"),
            groupName: f.get("groupName"),
            description: f.get("description"),
            username: f.get("username"),
            domain: f.get("domain") ?? "",
            ...(f.get("password") ? { password: f.get("password") } : {}),
            hostKey: f.get("hostKey") ?? "",
            ignoreCert: f.get("ignoreCert") === "on",
            enabled: f.get("enabled") === "on",
          };
          try {
            await api(asset ? `/assets/${asset.id}` : "/assets", {
              method: asset ? "PUT" : "POST",
              body: JSON.stringify(input),
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox text={error} />
        <div className="form-grid">
          <Field label="Tên máy">
            <input
              name="name"
              defaultValue={asset?.name}
              required
              maxLength={120}
              placeholder="VD: WEB-PROD-01"
            />
          </Field>
          <Field label="Nhóm máy">
            <input
              name="groupName"
              defaultValue={asset?.groupName ?? "Production"}
              required
              maxLength={80}
            />
          </Field>
          <Field label="Địa chỉ IPv4">
            <input
              name="host"
              defaultValue={asset?.host}
              required
              placeholder="10.10.20.15"
            />
          </Field>
          <Field label="Hệ điều hành">
            <select
              name="os"
              defaultValue={asset?.os ?? "windows"}
              key={protocol}
            >
              <option value={protocol === "ssh" ? "linux" : "windows"}>
                {protocol === "ssh" ? "Linux" : "Windows"}
              </option>
              {protocol === "rdp" && (
                <option value="linux">Linux (xrdp)</option>
              )}
            </select>
          </Field>
          <Field label="Giao thức">
            <select
              value={protocol}
              onChange={(e) => {
                setProtocol(e.target.value);
                setPort(e.target.value === "ssh" ? 22 : 3389);
              }}
            >
              <option value="rdp">RDP · Màn hình từ xa</option>
              <option value="ssh">SSH · Terminal</option>
            </select>
          </Field>
          <Field label="Cổng kết nối">
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              required
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </Field>
          <Field label="Tài khoản máy đích">
            <input
              name="username"
              autoComplete="off"
              defaultValue={asset?.username}
              required
              placeholder={protocol === "ssh" ? "vm-operator" : "Administrator"}
            />
          </Field>
          <Field
            label={
              asset
                ? "Mật khẩu mới (để trống để giữ nguyên)"
                : "Mật khẩu máy đích"
            }
          >
            <input
              name="password"
              autoComplete="new-password"
              type="password"
              required={!asset}
            />
          </Field>
        </div>
        {protocol === "rdp" ? (
          <>
            <Field label="Domain (để trống nếu tài khoản local)">
              <input name="domain" defaultValue={asset?.domain} />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                name="ignoreCert"
                defaultChecked={asset?.ignoreCert}
              />{" "}
              Chấp nhận chứng thư RDP tự ký chưa được tin cậy
            </label>
            <p className="field-hint">
              Ưu tiên chứng thư do CA nội bộ cấp. Tùy chọn này bỏ kiểm tra chứng
              thư máy đích.
            </p>
          </>
        ) : (
          <Field
            label="SSH host key đã xác minh"
            hint="Dán một dòng known_hosts; xác minh fingerprint với quản trị máy trước khi thêm."
          >
            <textarea
              name="hostKey"
              rows={3}
              required
              defaultValue={asset?.hostKey}
              placeholder="10.10.20.15 ssh-ed25519 AAAAC3…"
            />
          </Field>
        )}
        <Field label="Ghi chú">
          <textarea
            name="description"
            rows={2}
            defaultValue={asset?.description}
            maxLength={1000}
          />
        </Field>
        <label className="checkbox">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={asset?.enabled ?? true}
          />{" "}
          Cho phép kết nối
        </label>
        {asset && (
          <p className="field-hint">
            Lưu thay đổi sẽ ngắt các phiên đang sử dụng máy này.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu máy ảo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AssetCard({
  asset,
  admin,
  canConnect,
  onConnect,
  onEdit,
}: {
  asset: Asset;
  admin: boolean;
  canConnect: boolean;
  onConnect: (a: Asset) => void;
  onEdit: (a: Asset) => void;
}) {
  return (
    <article className="asset-card">
      <div className="asset-card-top">
        <div className={`os-icon ${asset.os}`}>
          <Monitor size={23} strokeWidth={1.6} />
        </div>
        <Badge tone={asset.enabled ? "green" : "gray"}>
          <span className="status-dot" />
          {asset.enabled ? "Được phép kết nối" : "Đã khóa"}
        </Badge>
        {admin && (
          <button
            className="icon-button"
            aria-label={`Cấu hình ${asset.name}`}
            onClick={() => onEdit(asset)}
          >
            <MoreHorizontal size={19} />
          </button>
        )}
      </div>
      <h3>{asset.name}</h3>
      <p className="asset-ip mono">
        {asset.host}
        <span>:{asset.port}</span>
      </p>
      <p className="asset-description">
        {asset.description || "Chưa có ghi chú cho máy này."}
      </p>
      <div className="asset-tags">
        <span>
          <Folder size={13} />
          {asset.groupName}
        </span>
        <span>{asset.os === "windows" ? "Windows" : "Linux"}</span>
        <span>{asset.protocol.toUpperCase()}</span>
      </div>
      <div className="asset-card-bottom">
        <span>
          <LockKeyhole size={13} />
          Thông tin xác thực được bảo vệ
        </span>
        {canConnect && (
          <button
            className="connect-button"
            disabled={!asset.enabled}
            onClick={() => onConnect(asset)}
          >
            Kết nối <ArrowRight size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

function Assets({
  user,
  refresh,
  onRefresh,
  onConnect,
  onEdit,
  onAdd,
  onImport,
}: {
  user: User;
  refresh: number;
  onRefresh: () => void;
  onConnect: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const [q, setQ] = useState(""),
    [os, setOs] = useState("all"),
    [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(
    `/assets?page=${page}&limit=12&os=${os}&q=${encodeURIComponent(q)}`,
    refresh,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TÀI NGUYÊN HẠ TẦNG</span>
          <h1>
            Máy ảo <span className="title-count">{data?.total ?? "—"}</span>
          </h1>
          <p>Truy cập an toàn các máy chủ được cấp quyền.</p>
        </div>
        {user.role === "admin" && (
          <div className="heading-actions">
            <button className="button secondary" onClick={onImport}>
              <ArrowDownToLine size={16} />
              Nhập hàng loạt
            </button>
            <button className="button" onClick={onAdd}>
              <Plus size={17} />
              Thêm máy ảo
            </button>
          </div>
        )}
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["all", "Tất cả máy"],
            ["windows", "Windows"],
            ["linux", "Linux"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={os === value ? "selected" : ""}
              onClick={() => {
                setOs(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm tên máy, IP, nhóm…"
          />
          <button
            className="icon-button bordered"
            aria-label="Làm mới máy ảo"
            onClick={onRefresh}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <ErrorBox text={error} />
      {loading ? (
        <Loading />
      ) : data?.items.length ? (
        <>
          <div className="asset-grid">
            {data.items.map((a: Asset) => (
              <AssetCard
                key={a.id}
                asset={a}
                admin={user.role === "admin"}
                canConnect={user.role !== "auditor"}
                onConnect={onConnect}
                onEdit={onEdit}
              />
            ))}
          </div>
          <Pager page={page} limit={12} total={data.total} onChange={setPage} />
        </>
      ) : (
        <div className="panel">
          <Empty
            title={
              q || os !== "all"
                ? "Không tìm thấy máy phù hợp"
                : "Chưa có máy ảo nào"
            }
            text={
              user.role === "admin"
                ? "Thêm máy Windows hoặc Linux đầu tiên để bắt đầu quản lý truy cập."
                : "Các máy được quản trị viên cấp quyền sẽ hiển thị ở đây."
            }
            action={
              user.role === "admin" && !q ? (
                <button className="button" onClick={onAdd}>
                  <Plus size={16} />
                  Thêm máy ảo
                </button>
              ) : undefined
            }
          />
        </div>
      )}
      <div className="inline-note">
        <ShieldCheck size={16} />
        <span>
          Trạng thái cho biết quyền kết nối. Khả năng truy cập máy đích được xác
          định khi mở phiên.
        </span>
      </div>
    </>
  );
}

function Overview({
  user,
  refresh,
  onNavigate,
  onConnect,
  onEdit,
  onAdd,
}: {
  user: User;
  refresh: number;
  onNavigate: (v: View) => void;
  onConnect: (a: Asset) => void;
  onEdit: (a: Asset) => void;
  onAdd: () => void;
}) {
  const { data, error, loading } = useLoad("/dashboard", refresh);
  const assets = useLoad("/assets?limit=3", refresh),
    sessions = useLoad("/sessions?limit=5", refresh);
  const cards = [
    {
      label: "Máy ảo được quản lý",
      value: data?.totalAssets,
      icon: Server,
      tone: "teal",
      detail: `${data?.enabledAssets ?? 0} máy được bật kết nối`,
    },
    {
      label: "Phiên đang hoạt động",
      value: data?.activeSessions,
      icon: Activity,
      tone: "blue",
      detail: `Giới hạn ${data?.maxSessions ?? "—"} phiên đồng thời`,
    },
    {
      label: "Tài khoản hoạt động",
      value: data?.activeUsers,
      icon: Users,
      tone: "purple",
      detail:
        user.role === "operator"
          ? "Tài khoản cá nhân của bạn"
          : "Đăng nhập với xác thực MFA",
    },
    {
      label: "Tổng lượt truy cập",
      value: data?.totalSessions,
      icon: FileClock,
      tone: "amber",
      detail: "Bao gồm yêu cầu kết nối",
    },
  ];
  const live =
    sessions.data?.items.filter((s: any) => s.status === "active").length ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span>
          <h1>Tổng quan hệ thống</h1>
          <p>Chào {user.displayName}, hạ tầng của bạn bắt đầu từ đây.</p>
        </div>
        <div className="date-pill">
          <Clock3 size={16} />
          {new Intl.DateTimeFormat("vi-VN", {
            dateStyle: "long",
            timeZone: "Asia/Ho_Chi_Minh",
          }).format(new Date())}
        </div>
      </div>
      <ErrorBox text={error} />
      <div className="stats-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div>
              <span>{c.label}</span>
              <div className={`stat-icon ${c.tone}`}>
                <c.icon size={19} />
              </div>
            </div>
            <strong>{loading ? "—" : (c.value ?? 0)}</strong>
            <small>{c.detail}</small>
          </div>
        ))}
      </div>
      <div className="security-banner">
        <div className="security-banner-icon">
          <ShieldCheck size={30} strokeWidth={1.5} />
        </div>
        <div>
          <h3>Truy cập tập trung. Kiểm soát đến từng phiên.</h3>
          <p>Mỗi kết nối được xác thực, phân quyền và ghi lại tại gateway.</p>
        </div>
        <span>
          <span className="status-dot" />
          MFA bắt buộc
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>Máy ảo của bạn</h2>
          <p>Chọn một máy để bắt đầu làm việc.</p>
        </div>
        <button className="text-button" onClick={() => onNavigate("assets")}>
          Xem tất cả <ArrowRight size={16} />
        </button>
      </div>
      <ErrorBox text={assets.error} />
      {assets.loading ? (
        <Loading />
      ) : assets.data?.items.length ? (
        <div className="asset-grid">
          {assets.data.items.map((a: Asset) => (
            <AssetCard
              key={a.id}
              asset={a}
              admin={user.role === "admin"}
              canConnect={user.role !== "auditor"}
              onConnect={onConnect}
              onEdit={onEdit}
            />
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Không gian làm việc đã sẵn sàng"
            text={
              user.role === "admin"
                ? "Thêm máy ảo, tạo người dùng và cấp quyền để bắt đầu."
                : "Liên hệ quản trị viên để được cấp quyền truy cập máy."
            }
            action={
              user.role === "admin" ? (
                <button className="button" onClick={onAdd}>
                  <Plus size={16} />
                  Thêm máy đầu tiên
                </button>
              ) : undefined
            }
          />
        </div>
      )}
      <div className="overview-bottom">
        <section className="panel">
          <div className="panel-heading">
            <h2>Truy cập gần đây</h2>
            <button
              className="text-button"
              onClick={() => onNavigate("sessions")}
            >
              Lịch sử <ArrowRight size={15} />
            </button>
          </div>
          <ErrorBox text={sessions.error} />
          {sessions.data?.items.length ? (
            <div className="recent-list">
              {sessions.data.items.map((s: any) => (
                <div key={s.id} className="recent-row">
                  <div
                    className={`recent-icon ${s.protocol === "ssh" ? "purple" : "blue"}`}
                  >
                    {s.protocol === "ssh" ? (
                      <Terminal size={18} />
                    ) : (
                      <Monitor size={18} />
                    )}
                  </div>
                  <div>
                    <strong>{s.assetName}</strong>
                    <small>
                      {s.username} · {date(s.requestedAt)}
                    </small>
                  </div>
                  <SessionBadge status={s.status} />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={Clock3}
              title="Chưa có lịch sử truy cập"
              text="Các phiên làm việc sẽ xuất hiện tại đây."
            />
          )}
        </section>
        <section className="panel getting-started">
          <div className="panel-heading">
            <h2>Chính sách truy cập</h2>
            <Shield size={18} />
          </div>
          <div className="policy-item">
            <div>
              <Check size={15} />
            </div>
            <span>
              <strong>Xác thực hai lớp</strong>
              <small>Bắt buộc với tất cả tài khoản</small>
            </span>
          </div>
          <div className="policy-item">
            <div>
              <Check size={15} />
            </div>
            <span>
              <strong>Bảo vệ mật khẩu máy đích</strong>
              <small>Chỉ sử dụng ở phía gateway</small>
            </span>
          </div>
          <div className="policy-item">
            <div>
              <Check size={15} />
            </div>
            <span>
              <strong>Ghi lại màn hình phiên</strong>
              <small>Lưu tách biệt với máy được truy cập</small>
            </span>
          </div>
          <div className="policy-item">
            <div>
              <Check size={15} />
            </div>
            <span>
              <strong>Giới hạn dữ liệu truyền</strong>
              <small>Clipboard và truyền tệp đã tắt</small>
            </span>
          </div>
          <div className="policy-footer">
            <LockKeyhole size={14} />
            Kết nối qua mạng nội bộ / VPN
          </div>
        </section>
      </div>
    </>
  );
}

function SessionBadge({ status }: { status: string }) {
  const states: Record<string, [string, string]> = {
    active: ["Đang hoạt động", "green"],
    connecting: ["Đang kết nối", "blue"],
    pending: ["Chờ kết nối", "amber"],
    ended: ["Đã kết thúc", "gray"],
    terminated: ["Đã ngắt", "amber"],
    failed: ["Thất bại", "red"],
    expired: ["Hết hạn vé", "gray"],
    interrupted: ["Gián đoạn", "red"],
  };
  const [name, tone] = states[status] ?? [status, "gray"];
  return <Badge tone={tone}>{name}</Badge>;
}

function Sessions({
  user,
  refresh,
  onRefresh,
  onRecording,
  notify,
}: {
  user: User;
  refresh: number;
  onRefresh: () => void;
  onRecording: (id: string) => void;
  notify: (s: string) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("all"),
    [terminate, setTerminate] = useState<string | null>(null);
  const { data, error, loading } = useLoad(
    `/sessions?page=${page}&limit=15&status=${status}&q=${encodeURIComponent(q)}`,
    refresh,
  );
  useEffect(() => {
    const t = setInterval(onRefresh, 15000);
    return () => clearInterval(t);
  }, [onRefresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">GIÁM SÁT TRUY CẬP</span>
          <h1>Phiên truy cập</h1>
          <p>
            Theo dõi kết nối và xem lại lịch sử làm việc. Giờ Việt Nam (UTC+7).
          </p>
        </div>
        <button className="button secondary" onClick={onRefresh}>
          <RefreshCw size={16} />
          Làm mới
        </button>
      </div>
      <div className="panel">
        <div className="toolbar in-panel">
          <div className="tabs">
            {[
              ["all", "Tất cả phiên"],
              ["live", "Đang kết nối"],
              ["recorded", "Có bản ghi"],
            ].map(([v, t]) => (
              <button
                key={v}
                className={status === v ? "selected" : ""}
                onClick={() => {
                  setStatus(v);
                  setPage(1);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm máy hoặc tài khoản…"
          />
        </div>
        <ErrorBox text={error} />
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Máy đích / Tài khoản</th>
                  <th>Thời điểm yêu cầu</th>
                  <th>Thời lượng</th>
                  <th>IP nguồn</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.assetName}</strong>
                      <small>
                        {s.username} · {s.protocol.toUpperCase()}
                      </small>
                    </td>
                    <td>{date(s.requestedAt)}</td>
                    <td className="mono">{duration(s.startedAt, s.endedAt)}</td>
                    <td className="mono">{s.sourceIp || "—"}</td>
                    <td>
                      <SessionBadge status={s.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        {!!s.recordingAvailable && user.role !== "operator" && (
                          <button
                            className="text-button"
                            onClick={() => onRecording(s.id)}
                          >
                            <Eye size={15} />
                            Xem lại
                          </button>
                        )}
                        {["active", "connecting", "pending"].includes(
                          s.status,
                        ) &&
                          user.role !== "auditor" && (
                            <button
                              className="text-button red-text"
                              onClick={() => setTerminate(s.id)}
                            >
                              Ngắt phiên
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Activity}
            title="Chưa có phiên phù hợp"
            text="Phiên được tạo khi người dùng bấm kết nối tới máy ảo."
          />
        )}
        {data && (
          <Pager page={page} limit={15} total={data.total} onChange={setPage} />
        )}
      </div>
      {terminate && (
        <Modal
          title="Ngắt phiên truy cập?"
          subtitle="Kết nối remote sẽ kết thúc ngay. Phiên đăng nhập hệ điều hành có thể vẫn tồn tại trên máy đích."
          onClose={() => setTerminate(null)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setTerminate(null)}
            >
              Hủy
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await post(`/sessions/${terminate}/terminate`);
                  setTerminate(null);
                  onRefresh();
                  notify("Đã ngắt phiên truy cập.");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              Ngắt phiên
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function UserForm({
  user,
  onClose,
  onDone,
}: {
  user?: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  if (reset && user)
    return (
      <ResetAuth user={user} onClose={() => setReset(false)} onDone={onDone} />
    );
  return (
    <Modal
      title={user ? "Cập nhật người dùng" : "Tạo người dùng"}
      subtitle="Mỗi người dùng có tài khoản cá nhân và thiết lập MFA riêng."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          const input = user
            ? {
                displayName: f.get("displayName"),
                role: f.get("role"),
                active: f.get("active") === "on",
              }
            : {
                username: f.get("username"),
                displayName: f.get("displayName"),
                password: f.get("password"),
                role: f.get("role"),
              };
          try {
            await api(user ? `/users/${user.id}` : "/users", {
              method: user ? "PATCH" : "POST",
              body: JSON.stringify(input),
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox text={error} />
        <Field label="Họ và tên">
          <input
            name="displayName"
            defaultValue={user?.displayName}
            required
            maxLength={120}
          />
        </Field>
        {!user && (
          <>
            <Field
              label="Tên đăng nhập"
              hint="3–64 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới."
            >
              <input
                name="username"
                autoComplete="off"
                required
                pattern="[a-z0-9][a-z0-9._\-]{2,63}"
              />
            </Field>
            <Field
              label="Mật khẩu tạm thời"
              hint="Tối thiểu 14 ký tự. Người dùng bắt buộc đổi ở lần đăng nhập đầu."
            >
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={14}
                maxLength={128}
                required
              />
            </Field>
          </>
        )}
        <Field label="Vai trò">
          <select name="role" defaultValue={user?.role ?? "operator"}>
            <option value="operator">Vận hành · Truy cập máy được cấp</option>
            <option value="auditor">Kiểm toán · Xem log và bản ghi</option>
            <option value="admin">Quản trị · Toàn bộ máy và cấu hình</option>
          </select>
        </Field>
        {user && (
          <>
            <label className="checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={user.active}
              />
              Tài khoản hoạt động
            </label>
            <p className="field-hint">
              Cập nhật sẽ kết thúc các phiên đăng nhập và remote của tài khoản
              này.
            </p>
          </>
        )}
        <div className="modal-actions">
          {user && (
            <button
              type="button"
              className="text-button"
              onClick={() => setReset(true)}
            >
              Khôi phục đăng nhập
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="button" disabled={busy}>
            {busy ? "Đang lưu…" : "Lưu tài khoản"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ResetAuth({
  user,
  onClose,
  onDone,
}: {
  user: User;
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Khôi phục đăng nhập"
      subtitle={`Tài khoản @${user.username}. Tất cả phiên hiện tại sẽ được kết thúc.`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await post(`/users/${user.id}/reset-auth`, {
              adminPassword: f.get("adminPassword"),
              ...(f.get("password") ? { newPassword: f.get("password") } : {}),
              resetMfa: f.get("resetMfa") === "on",
              reason: f.get("reason"),
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox text={error} />
        <Field label="Mật khẩu quản trị viên hiện tại">
          <input
            name="adminPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field
          label="Mật khẩu tạm thời mới (tùy chọn)"
          hint="Tối thiểu 14 ký tự. Người dùng phải đổi ở lần đăng nhập tiếp theo."
        >
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={14}
            maxLength={128}
          />
        </Field>
        <label className="checkbox">
          <input name="resetMfa" type="checkbox" />
          Yêu cầu thiết lập lại MFA và hủy mã khôi phục cũ
        </label>
        <Field label="Lý do khôi phục">
          <textarea
            name="reason"
            minLength={5}
            maxLength={500}
            required
            rows={2}
          />
        </Field>
        <p className="field-hint">
          Xác minh danh tính người dùng qua kênh nội bộ trước khi đặt lại. Không
          thể dùng chức năng này cho chính tài khoản quản trị đang đăng nhập.
        </p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Quay lại
          </button>
          <button className="button danger" disabled={busy}>
            {busy ? "Đang cập nhật…" : "Đặt lại thông tin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function UsersView({
  refresh,
  onRefresh,
}: {
  refresh: number;
  onRefresh: () => void;
}) {
  const { data, error, loading } = useLoad("/users", refresh),
    [q, setQ] = useState(""),
    [edit, setEdit] = useState<User | null | undefined>(undefined);
  const users =
    data?.items.filter((u: User) =>
      `${u.username} ${u.displayName}`.toLowerCase().includes(q.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DANH TÍNH & TÀI KHOẢN</span>
          <h1>Người dùng</h1>
          <p>Quản lý tài khoản cá nhân, vai trò và trạng thái truy cập.</p>
        </div>
        <button className="button" onClick={() => setEdit(null)}>
          <Plus size={17} />
          Tạo người dùng
        </button>
      </div>
      <div className="panel">
        <div className="toolbar in-panel">
          <h2>{data?.items.length ?? 0} tài khoản</h2>
          <SearchBox value={q} onChange={setQ} placeholder="Tìm người dùng…" />
        </div>
        <ErrorBox text={error} />
        {loading ? (
          <Loading />
        ) : users.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Vai trò</th>
                  <th>Xác thực hai lớp</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u: User) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <span className="avatar">
                          {u.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{u.displayName}</strong>
                          <small>@{u.username}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          u.role === "admin"
                            ? "purple"
                            : u.role === "auditor"
                              ? "blue"
                              : "gray"
                        }
                      >
                        {roleName[u.role]}
                      </Badge>
                    </td>
                    <td>
                      {u.mfaEnabled ? (
                        <span className="green-text">
                          <ShieldCheck size={14} />
                          Đã thiết lập
                        </span>
                      ) : (
                        <span className="muted">Chờ thiết lập</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={u.active ? "green" : "gray"}>
                        {u.active ? "Hoạt động" : "Đã khóa"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setEdit(u)}
                      >
                        Chỉnh sửa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Users}
            title="Không tìm thấy người dùng"
            text="Thử tìm bằng tên đăng nhập hoặc họ tên."
          />
        )}
      </div>
      <div className="inline-note">
        <Shield size={16} />
        Quản trị viên được truy cập toàn bộ máy. Tài khoản vận hành cần được cấp
        quyền từng máy.
      </div>
      {edit !== undefined && (
        <UserForm
          user={edit ?? undefined}
          onClose={() => setEdit(undefined)}
          onDone={() => {
            setEdit(undefined);
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function GrantForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const users = useLoad("/users"),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const assets = useLoad(
    `/assets?limit=50&page=${page}&q=${encodeURIComponent(q)}`,
  );
  return (
    <Modal
      title="Cấp quyền truy cập máy"
      subtitle="Quyền được kiểm tra lại khi kết nối và trong khi phiên đang chạy."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await post("/grants", {
              userId: f.get("userId"),
              assetIds: [...selected],
              expiresAt: f.get("expires")
                ? new Date(String(f.get("expires"))).getTime()
                : null,
            });
            onDone();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ErrorBox text={error || users.error || assets.error} />
        <div className="form-grid">
          <Field label="Người dùng vận hành">
            <select name="userId" required defaultValue="">
              <option value="" disabled>
                Chọn người dùng
              </option>
              {users.data?.items
                .filter((u: User) => u.role === "operator" && u.active)
                .map((u: User) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} (@{u.username})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Hết hạn (để trống nếu không giới hạn)">
            <input type="datetime-local" name="expires" />
          </Field>
        </div>
        <div className="selection-heading">
          <strong>Chọn máy ảo · {selected.size} đã chọn</strong>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm máy để cấp quyền…"
          />
        </div>
        <div className="asset-select-list">
          {assets.data?.items.map((a: Asset) => (
            <label className="asset-select" key={a.id}>
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={(e) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    e.target.checked ? next.add(a.id) : next.delete(a.id);
                    return next;
                  })
                }
              />
              <Monitor size={18} />
              <span>
                <strong>{a.name}</strong>
                <small>
                  {a.host} · {a.groupName}
                </small>
              </span>
              <Badge>{a.protocol.toUpperCase()}</Badge>
            </label>
          ))}
          {assets.loading && <Loading />}
          {assets.data?.total === 0 && (
            <p className="muted">Chưa có máy để cấp quyền.</p>
          )}
        </div>
        {assets.data && (
          <Pager
            page={page}
            limit={50}
            total={assets.data.total}
            onChange={setPage}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="button" disabled={busy || !selected.size}>
            {busy ? "Đang cấp quyền…" : `Cấp quyền ${selected.size} máy`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Grants({
  refresh,
  onRefresh,
  notify,
}: {
  refresh: number;
  onRefresh: () => void;
  notify: (s: string) => void;
}) {
  const { data, error, loading } = useLoad("/grants", refresh),
    [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [revoke, setRevoke] = useState<any>(null);
  const rows =
    data?.items.filter((g: any) =>
      `${g.username} ${g.displayName} ${g.assetName}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KIỂM SOÁT QUYỀN TRUY CẬP</span>
          <h1>Phân quyền máy ảo</h1>
          <p>Chỉ cấp quyền tới các máy cần thiết cho công việc.</p>
        </div>
        <button className="button" onClick={() => setOpen(true)}>
          <Plus size={17} />
          Cấp quyền truy cập
        </button>
      </div>
      <div className="panel">
        <div className="toolbar in-panel">
          <h2>{data?.items.length ?? 0} quyền được cấp</h2>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Tìm tài khoản hoặc máy…"
          />
        </div>
        <ErrorBox text={error} />
        {loading ? (
          <Loading />
        ) : rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Máy được cấp quyền</th>
                  <th>Thời hạn</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((g: any) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.displayName}</strong>
                      <small>@{g.username}</small>
                    </td>
                    <td>
                      <span className="with-icon">
                        <Monitor size={16} />
                        {g.assetName}
                      </span>
                    </td>
                    <td>
                      {g.expiresAt ? date(g.expiresAt) : "Không giới hạn"}
                    </td>
                    <td>
                      <Badge
                        tone={
                          g.expiresAt && Number(g.expiresAt) < Date.now()
                            ? "gray"
                            : "green"
                        }
                      >
                        {g.expiresAt && Number(g.expiresAt) < Date.now()
                          ? "Hết hạn"
                          : "Đang hiệu lực"}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="text-button red-text"
                        onClick={() => setRevoke(g)}
                      >
                        Thu hồi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={KeyRound}
            title="Chưa có quyền phù hợp"
            text="Cấp quyền máy ảo cho tài khoản vận hành để họ bắt đầu làm việc."
          />
        )}
      </div>
      {open && (
        <GrantForm
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onRefresh();
          }}
        />
      )}
      {revoke && (
        <Modal
          title="Thu hồi quyền truy cập?"
          subtitle={`${revoke.username} sẽ mất quyền vào ${revoke.assetName}. Các phiên hiện tại của người dùng sẽ được ngắt.`}
          onClose={() => setRevoke(null)}
        >
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setRevoke(null)}
            >
              Hủy
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await api(`/grants/${revoke.id}`, { method: "DELETE" });
                  setRevoke(null);
                  onRefresh();
                  notify("Đã thu hồi quyền truy cập.");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              Thu hồi quyền
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

const eventLabels: Record<string, string> = {
  "auth.login": "Đăng nhập thành công",
  "auth.login_failed": "Đăng nhập thất bại",
  "auth.mfa_failed": "MFA thất bại",
  "auth.logout": "Đăng xuất",
  "auth.password_changed": "Đổi mật khẩu",
  "auth.recovery_login": "Đăng nhập bằng mã khôi phục",
  "asset.created": "Thêm máy ảo",
  "asset.updated": "Cập nhật máy ảo",
  "asset.imported": "Nhập danh sách máy",
  "user.auth_reset": "Khôi phục đăng nhập",
  "user.created": "Tạo người dùng",
  "user.updated": "Cập nhật người dùng",
  "grant.created": "Cấp quyền truy cập",
  "grant.revoked": "Thu hồi quyền",
  "remote.requested": "Yêu cầu kết nối",
  "remote.ended": "Kết thúc phiên",
  "remote.terminated": "Ngắt phiên",
  "recording.viewed": "Xem bản ghi",
  "audit.exported": "Xuất nhật ký",
  "admin.bootstrapped": "Khởi tạo quản trị viên",
};
function Audit({
  refresh,
  notify,
}: {
  refresh: number;
  notify: (s: string) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [action, setAction] = useState(""),
    [detail, setDetail] = useState<any>(null);
  const params = `q=${encodeURIComponent(q)}&action=${encodeURIComponent(action)}`;
  const { data, error, loading } = useLoad(
    `/audit?page=${page}&limit=20&${params}`,
    refresh,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">KIỂM TOÁN & TRUY VẾT</span>
          <h1>Nhật ký hệ thống</h1>
          <p>
            Lịch sử xác thực, thay đổi quyền và hoạt động truy cập. Giờ Việt Nam
            (UTC+7).
          </p>
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              const res = await fetch(`/api/audit?format=csv&${params}`);
              if (!res.ok) throw new Error("Không thể xuất nhật ký.");
              const url = URL.createObjectURL(await res.blob());
              const a = document.createElement("a");
              a.href = url;
              a.download = "nhat-ky-kiem-toan.csv";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e: any) {
              notify(e.message);
            }
          }}
        >
          <ArrowDownToLine size={16} />
          Xuất CSV
        </button>
      </div>
      <div className="panel">
        <div className="toolbar in-panel">
          <select
            aria-label="Loại sự kiện"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả sự kiện</option>
            <option value="auth.">Xác thực</option>
            <option value="remote.">Truy cập remote</option>
            <option value="grant.">Phân quyền</option>
            <option value="asset.">Máy ảo</option>
            <option value="user.">Người dùng</option>
          </select>
          <SearchBox
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Tìm tài khoản, sự kiện…"
          />
        </div>
        <ErrorBox text={error} />
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Tài khoản</th>
                  <th>Sự kiện</th>
                  <th>IP nguồn</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((e: any) => (
                  <tr key={e.id}>
                    <td>{date(e.createdAt)}</td>
                    <td>
                      <strong>{e.actorName}</strong>
                    </td>
                    <td>
                      <span className="event-name">
                        <span
                          className={`event-dot ${e.action.includes("failed") ? "red" : ""}`}
                        />
                        {eventLabels[e.action] ?? e.action}
                      </span>
                      <small className="mono">{e.action}</small>
                    </td>
                    <td className="mono">{e.sourceIp || "—"}</td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => setDetail(e)}
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={FileClock}
            title="Không có sự kiện phù hợp"
            text="Thử thay đổi bộ lọc để xem các sự kiện khác."
          />
        )}
        {data && (
          <Pager page={page} limit={20} total={data.total} onChange={setPage} />
        )}
      </div>
      {detail && (
        <Modal
          title="Chi tiết sự kiện"
          subtitle={eventLabels[detail.action] ?? detail.action}
          onClose={() => setDetail(null)}
        >
          <dl className="detail-list">
            <dt>Thời gian</dt>
            <dd>{date(detail.createdAt)}</dd>
            <dt>Tài khoản</dt>
            <dd>{detail.actorName}</dd>
            <dt>IP nguồn</dt>
            <dd>{detail.sourceIp || "—"}</dd>
            <dt>Đối tượng</dt>
            <dd className="mono">{detail.resourceId || "—"}</dd>
          </dl>
          <pre className="json-view">
            {JSON.stringify(JSON.parse(detail.details), null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
function Settings({ refresh }: { refresh: number }) {
  const { data, error, loading } = useLoad("/system", refresh);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CẤU HÌNH & TRIỂN KHAI</span>
          <h1>Hệ thống</h1>
          <p>Thông số vận hành được quản lý bằng cấu hình trên máy chủ.</p>
        </div>
        <Badge tone="green">
          <ShieldCheck size={13} />
          Cổng nội bộ
        </Badge>
      </div>
      <ErrorBox text={error} />
      {loading ? (
        <Loading />
      ) : (
        data && (
          <div className="settings-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Hạ tầng dịch vụ</h2>
                <Server size={18} />
              </div>
              <div className="setting-row">
                <span>Cơ sở dữ liệu</span>
                <strong>{data.database}</strong>
              </div>
              <div className="setting-row">
                <span>Mô hình gateway</span>
                <strong>Một gateway</strong>
              </div>
              <div className="setting-row">
                <span>Giới hạn phiên đồng thời</span>
                <strong>{data.maxSessions}</strong>
              </div>
              <div className="setting-row">
                <span>Thời hạn đăng nhập</span>
                <strong>{data.sessionHours} giờ</strong>
              </div>
              <div className="setting-row">
                <span>Thư mục bản ghi</span>
                <Badge tone={data.recordingStorageReady ? "green" : "red"}>
                  {data.recordingStorageReady ? "Đã tạo" : "Chưa sẵn sàng"}
                </Badge>
              </div>
              <div className="setting-row">
                <span>Dải IP máy đích</span>
                <code>{data.allowedNetworks}</code>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Chính sách bảo mật</h2>
                <Shield size={18} />
              </div>
              {[
                ["Xác thực MFA", "Bắt buộc"],
                ["Mật khẩu máy ảo", "Mã hóa AES-256-GCM"],
                ["Mật khẩu website", "Băm scrypt"],
                ["Vé kết nối", "Một lần · 30 giây"],
                ["Clipboard / Truyền tệp", "Đã tắt"],
                ["Đổi mật khẩu máy đích", "Quản trị thủ công"],
                ["Đồng bộ vCenter", "Chưa tích hợp"],
              ].map(([k, v]) => (
                <div className="setting-row" key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </section>
            <section className="panel settings-note">
              <CircleHelp size={22} />
              <div>
                <h3>Phạm vi bảo vệ của hệ thống</h3>
                <p>
                  Cổng không gửi mật khẩu máy đích tới trình duyệt. Người có
                  toàn quyền Administrator/root vẫn có thể thay đổi hệ điều hành
                  và tạo đường truy cập khác. Cần kiểm soát firewall, tài khoản
                  và lưu bản ghi tách biệt.
                </p>
                <p>
                  Đổi mật khẩu máy đích tự động, đồng bộ vCenter và triển khai
                  nhiều gateway cần được bổ sung theo hạ tầng thực tế.
                </p>
              </div>
            </section>
          </div>
        )
      )}
    </>
  );
}

function ImportForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Nhập danh sách máy ảo"
      subtitle="Tệp JSON UTF-8, tối đa 500 máy/lần. Dữ liệu được xử lý toàn bộ hoặc không lưu nếu có lỗi."
      onClose={onClose}
      wide
    >
      <ErrorBox text={error} />
      <div className="import-zone">
        <ArrowDownToLine size={28} />
        <strong>Chọn tệp JSON danh sách máy</strong>
        <p>Chỉ chọn tệp trên máy quản trị tin cậy. Tệp có thể chứa mật khẩu.</p>
        <input
          aria-label="Tệp JSON máy ảo"
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            setError("");
            setItems([]);
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 2 * 1024 * 1024) {
              setError("Tệp vượt giới hạn 2 MB.");
              return;
            }
            try {
              const v = JSON.parse(await f.text());
              if (!Array.isArray(v) || !v.length || v.length > 500)
                throw new Error("Tệp cần chứa mảng từ 1 đến 500 máy.");
              setItems(v);
            } catch (e: any) {
              setError(e.message);
            }
          }}
        />
      </div>
      <p className="field-hint">Cấu trúc mỗi máy:</p>
      <pre className="json-view">
        {JSON.stringify(
          [
            {
              name: "WEB-PROD-01",
              host: "10.10.20.15",
              port: 3389,
              protocol: "rdp",
              os: "windows",
              groupName: "Production",
              username: "vm-operator",
              password: "<mật khẩu máy đích>",
              ignoreCert: false,
            },
          ],
          null,
          2,
        )}
      </pre>
      {items.length > 0 && (
        <div className="alert success">
          Đã đọc {items.length} máy. Mật khẩu không được hiển thị trong bản xem
          trước.
        </div>
      )}
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Hủy
        </button>
        <button
          className="button"
          disabled={busy || !items.length}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/assets/import", items);
              onDone();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Đang nhập…" : `Nhập ${items.length} máy`}
        </button>
      </div>
    </Modal>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null),
    [initializing, setInitializing] = useState(true),
    [view, setView] = useState<View>("overview");
  const [refresh, setRefresh] = useState(0),
    [toast, setToast] = useState(""),
    [assetEdit, setAssetEdit] = useState<Asset | null | undefined>(undefined);
  const [remote, setRemote] = useState<Asset | null>(null),
    [recording, setRecording] = useState<string | null>(null),
    [passwordModal, setPasswordModal] = useState(false),
    [importModal, setImportModal] = useState(false),
    [mobile, setMobile] = useState(false);
  const onRefresh = useCallback(() => setRefresh((v) => v + 1), []);
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    api("/auth/me")
      .then((r) => {
        setCsrf(r.csrfToken);
        setUser(r.user);
      })
      .catch(() => {})
      .finally(() => setInitializing(false));
    const expired = () => {
      setUser(null);
      setCsrf("");
      setRemote(null);
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const navigate = (v: View) => {
    setView(v);
    setMobile(false);
  };
  if (initializing)
    return (
      <div className="initial-loading">
        <Brand />
        <Loading />
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setView("overview");
          onRefresh();
        }}
      />
    );
  if (user.mustChangePassword)
    return (
      <div className="forced-password">
        <div className="panel">
          <Brand />
          <h2>Đặt mật khẩu của bạn</h2>
          <PasswordForm
            forced
            onDone={() => setUser({ ...user, mustChangePassword: false })}
          />
          <button
            className="text-button full"
            onClick={async () => {
              try {
                await post("/auth/logout");
                setUser(null);
                setCsrf("");
              } catch (e: any) {
                notify(e.message);
              }
            }}
          >
            Đăng xuất
          </button>
        </div>
      </div>
    );
  if (remote)
    return (
      <Remote
        asset={remote}
        onClose={() => {
          setRemote(null);
          onRefresh();
        }}
      />
    );
  const allowed = navigation.filter(
    (n) => !n.roles || n.roles.includes(user.role),
  );
  const props = {
    user,
    refresh,
    onRefresh,
    onConnect: setRemote,
    onEdit: (a: Asset) => setAssetEdit(a),
    onAdd: () => setAssetEdit(null),
    onImport: () => setImportModal(true),
  };
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <Brand light />
        <nav aria-label="Điều hướng chính">
          {allowed.map((n) => (
            <React.Fragment key={n.id}>
              {n.section && <div className="nav-section">{n.section}</div>}
              <button
                className={`nav-item ${view === n.id ? "active" : ""}`}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={18} />
                <span>{n.title}</span>
                {view === n.id && <span className="nav-indicator" />}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="vpn-note">
            <span className="status-dot" />
            <div>
              <strong>Truy cập nội bộ</strong>
              <small>Thông qua mạng VPN</small>
            </div>
            <ShieldCheck size={17} />
          </div>
          <button
            className="sidebar-profile"
            onClick={() => setPasswordModal(true)}
          >
            <span className="avatar">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.displayName}</strong>
              <small>{roleName[user.role]}</small>
            </span>
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="mobile-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span>Không gian quản trị</span>
            <ChevronRight size={14} />
            <strong>{allowed.find((n) => n.id === view)?.title}</strong>
          </div>
          <div>
            <span className="topbar-security">
              <ShieldCheck size={15} />
              MFA đã xác thực
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label="Đổi mật khẩu"
              onClick={() => setPasswordModal(true)}
            >
              <KeyRound size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Đăng xuất"
              onClick={async () => {
                try {
                  await post("/auth/logout");
                  setUser(null);
                  setCsrf("");
                } catch (e: any) {
                  notify(e.message);
                }
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {view === "overview" && <Overview {...props} onNavigate={navigate} />}
          {view === "assets" && <Assets {...props} />}
          {view === "users" && (
            <UsersView refresh={refresh} onRefresh={onRefresh} />
          )}
          {view === "grants" && (
            <Grants refresh={refresh} onRefresh={onRefresh} notify={notify} />
          )}
          {view === "sessions" && (
            <Sessions
              user={user}
              refresh={refresh}
              onRefresh={onRefresh}
              onRecording={setRecording}
              notify={notify}
            />
          )}
          {view === "audit" && <Audit refresh={refresh} notify={notify} />}
          {view === "settings" && <Settings refresh={refresh} />}
          <footer className="app-footer">
            <span>VM Access · Cổng truy cập hạ tầng tập trung</span>
            <span>
              <LockKeyhole size={12} />
              Phiên làm việc được kiểm toán
            </span>
          </footer>
        </main>
      </div>
      {assetEdit !== undefined && (
        <AssetForm
          asset={assetEdit ?? undefined}
          onClose={() => setAssetEdit(undefined)}
          onDone={() => {
            setAssetEdit(undefined);
            onRefresh();
            notify("Đã lưu cấu hình máy ảo.");
          }}
        />
      )}
      {passwordModal && (
        <Modal title="Đổi mật khẩu" onClose={() => setPasswordModal(false)}>
          <PasswordForm
            forced={false}
            onDone={() => {
              setPasswordModal(false);
              notify("Đã đổi mật khẩu.");
            }}
          />
        </Modal>
      )}
      {importModal && (
        <ImportForm
          onClose={() => setImportModal(false)}
          onDone={() => {
            setImportModal(false);
            onRefresh();
            notify("Đã nhập danh sách máy ảo.");
          }}
        />
      )}
      {recording && (
        <div className="modal-backdrop">
          <section
            className="modal recording-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Bản ghi phiên"
          >
            <Recording
              sessionId={recording}
              onClose={() => setRecording(null)}
            />
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Đóng thông báo"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
