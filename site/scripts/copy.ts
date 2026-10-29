import { byId } from "./dom";

/** Copy buttons: copy the command or config they name, and tell screen readers what happened. */
export function copy(): void {
  const status = byId("copy-status");
  document.querySelectorAll<HTMLElement>(".copy").forEach((btn) =>
    btn.addEventListener("click", () => {
      const el = byId(btn.dataset.copy ?? "");
      const done = () => {
        btn.textContent = "copied";
        btn.dataset.done = "";
        status.textContent = "Copied to the clipboard.";
        setTimeout(() => {
          btn.textContent = "copy";
          delete btn.dataset.done;
          status.textContent = "";
        }, 1600);
      };
      // no clipboard access: select the text, so the visitor can copy it by hand
      const selectText = () => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        btn.textContent = "press ⌘C";
        status.textContent = "The text is selected. Copy it with Command C or Control C.";
      };
      try {
        navigator.clipboard.writeText(el.textContent ?? "").then(done, selectText);
      } catch {
        selectText();
      }
    }),
  );
}
