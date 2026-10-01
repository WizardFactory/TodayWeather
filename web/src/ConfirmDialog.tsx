import { useEffect, useId, useRef, useState } from "react";
import { t } from "./i18n";
/** Native modal provides focus containment, Escape cancellation and return focus. */
export function useConfirm() {
  const [message, setMessage] = useState("");
  const element = useRef<HTMLDialogElement>(null),
    answer = useRef<(value: boolean) => void>(undefined);
  const trigger = useRef<HTMLElement | null>(null),
    id = useId();
  const finish = (value: boolean) => {
    const resolve = answer.current;
    const invoker = trigger.current;
    answer.current = undefined;
    trigger.current = null;
    element.current?.close();
    setMessage("");
    if (invoker?.isConnected) invoker.focus();
    resolve?.(value);
  };
  useEffect(() => {
    if (message && !element.current?.open) element.current?.showModal();
  }, [message]);
  useEffect(
    () => () => {
      answer.current?.(false);
    },
    [],
  );
  const confirm = (text: string, invoker: HTMLElement | null) =>
    new Promise<boolean>((resolve) => {
      answer.current?.(false);
      answer.current = resolve;
      // WebKit pointer activation need not focus the invoking control.
      trigger.current = invoker;
      setMessage(text);
    });
  return {
    confirm,
    dialog: (
      <dialog
        className="confirm-dialog"
        ref={element}
        aria-labelledby={id}
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
      >
        <h2 id={id}>{message}</h2>
        <div className="dialog-actions">
          <button className="button" autoFocus onClick={() => finish(false)}>
            {t("display.cancel")}
          </button>
          <button className="button primary" onClick={() => finish(true)}>
            {t("display.confirm")}
          </button>
        </div>
      </dialog>
    ),
  };
}
