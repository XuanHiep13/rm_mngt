const input = document.getElementById("origin");
const error = document.getElementById("error");
const button = document.getElementById("connect");
window.desktopSetup.settings().then((settings) => {
  input.value = settings.origin || "";
  error.textContent = settings.error || "";
}).catch(() => { error.textContent = "Không đọc được cấu hình desktop."; });
document.getElementById("server-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = "";
  try {
    const result = await window.desktopSetup.connect(input.value);
    if (!result.ok) error.textContent = result.error;
  } catch { error.textContent = "Không kết nối được. Vui lòng thử lại."; }
  finally { button.disabled = false; }
});
